import asyncio
import fcntl
import json
import logging
import os
import pty
import signal
import sqlite3
import struct
import tempfile
import termios

import platform

import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("terminal")

MAX_SESSIONS = 10
MAX_PARSE_BUF = 65536
MAX_BYTE_BUF = 131072
MAX_TERMINAL_SIZE = 500

app = FastAPI()

# Active session tracking
active_sessions: dict[int, tuple[int, int]] = {}  # session_id -> (pid, fd)


@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.get("/api/sysinfo")
async def sysinfo():
    cpu_freq = psutil.cpu_freq()
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    net = psutil.net_io_counters()
    temps = {}
    try:
        t = psutil.sensors_temperatures()
        if t:
            for name, entries in t.items():
                if entries:
                    temps[name] = entries[0].current
    except (AttributeError, Exception):
        pass

    return {
        "cpu": {
            "model": platform.processor() or platform.machine(),
            "cores_physical": psutil.cpu_count(logical=False),
            "cores_logical": psutil.cpu_count(logical=True),
            "freq_mhz": round(cpu_freq.current) if cpu_freq else None,
            "percent": psutil.cpu_percent(interval=0.1),
            "per_cpu": psutil.cpu_percent(percpu=True),
        },
        "memory": {
            "total_gb": round(mem.total / (1024**3), 1),
            "used_gb": round(mem.used / (1024**3), 1),
            "percent": mem.percent,
        },
        "disk": {
            "total_gb": round(disk.total / (1024**3), 1),
            "used_gb": round(disk.used / (1024**3), 1),
            "percent": disk.percent,
        },
        "network": {
            "sent_mb": round(net.bytes_sent / (1024**2), 1),
            "recv_mb": round(net.bytes_recv / (1024**2), 1),
        },
        "temps": temps,
        "os": f"{platform.system()} {platform.release()}",
        "hostname": platform.node(),
        "uptime_hours": round((psutil.boot_time() and (asyncio.get_event_loop().time() / 3600)) or 0, 1),
    }


app.mount("/static", StaticFiles(directory="static"), name="static")


def set_winsize(fd, rows, cols):
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def cleanup_process(pid, fd):
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        os.waitpid(pid, os.WNOHANG)
    except (OSError, ChildProcessError):
        pass
    try:
        os.close(fd)
    except OSError:
        pass


class ScrollbackDB:
    """SQLite-based scrollback buffer to keep history off-heap."""

    MAX_LINES = 10000

    def __init__(self):
        self._tmpfile = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._db_path = self._tmpfile.name
        self._tmpfile.close()
        self._conn = sqlite3.connect(self._db_path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=OFF")
        self._conn.execute(
            "CREATE TABLE scrollback (id INTEGER PRIMARY KEY AUTOINCREMENT, line_data TEXT NOT NULL)"
        )
        self._count = 0

    def push_line(self, line_cells: list):
        data = json.dumps(line_cells, ensure_ascii=False, separators=(",", ":"))
        self._conn.execute("INSERT INTO scrollback (line_data) VALUES (?)", (data,))
        self._count += 1
        if self._count % 100 == 0:
            self._conn.commit()
            self._trim()

    def get_lines(self, offset: int, limit: int) -> list:
        rows = self._conn.execute(
            "SELECT line_data FROM scrollback ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [json.loads(r[0]) for r in reversed(rows)]

    @property
    def count(self) -> int:
        return self._count

    def _trim(self):
        if self._count > self.MAX_LINES:
            delete_count = self._count - self.MAX_LINES
            self._conn.execute(
                "DELETE FROM scrollback WHERE id IN (SELECT id FROM scrollback ORDER BY id ASC LIMIT ?)",
                (delete_count,),
            )
            self._count = self.MAX_LINES

    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass
        try:
            os.unlink(self._db_path)
        except OSError:
            pass


class TerminalState:
    """Virtual terminal state that tracks screen buffer, cursor, and styles."""

    def __init__(self, rows=24, cols=80):
        self.rows = rows
        self.cols = cols
        self.cursor_row = 0
        self.cursor_col = 0
        self.saved_cursor = (0, 0)

        # Screen buffer: only visible area in memory
        self.screen = self._empty_screen()
        self.alt_screen = None

        # Scrollback history in SQLite
        self.scrollback = ScrollbackDB()

        # Current style
        self.fg = None
        self.bg = None
        self.bold = False
        self.dim = False
        self.italic = False
        self.underline = False
        self.strikethrough = False
        self.inverse = False

        # Scroll region
        self.scroll_top = 0
        self.scroll_bottom = rows - 1

        # Parse state
        self._buf = ""
        self._dirty = True

        # Terminal title
        self.title = ""

    def _empty_screen(self):
        return [[self._empty_cell() for _ in range(self.cols)] for _ in range(self.rows)]

    def _empty_cell(self):
        return (" ", None, None, False, False, False, False, False, False)

    def _current_cell(self):
        return (
            None,  # char placeholder
            self.fg,
            self.bg,
            self.bold,
            self.dim,
            self.italic,
            self.underline,
            self.strikethrough,
            self.inverse,
        )

    def resize(self, rows, cols):
        rows = min(rows, MAX_TERMINAL_SIZE)
        cols = min(cols, MAX_TERMINAL_SIZE)
        old_rows, old_cols = self.rows, self.cols
        self.rows = rows
        self.cols = cols
        self.scroll_top = 0
        self.scroll_bottom = rows - 1

        new_screen = self._empty_screen()
        for r in range(min(old_rows, rows)):
            for c in range(min(old_cols, cols)):
                new_screen[r][c] = self.screen[r][c]
        self.screen = new_screen

        self.cursor_row = min(self.cursor_row, rows - 1)
        self.cursor_col = min(self.cursor_col, cols - 1)
        self._dirty = True

    def clear(self):
        """Release screen buffers and close scrollback DB."""
        self.screen = None
        self.alt_screen = None
        self._buf = ""
        self.scrollback.close()

    def feed(self, data: str):
        """Process terminal data."""
        self._buf += data
        if len(self._buf) > MAX_PARSE_BUF:
            self._buf = self._buf[-MAX_PARSE_BUF:]
        self._dirty = True

        i = 0
        buf = self._buf
        n = len(buf)

        while i < n:
            ch = buf[i]

            if ch == "\x1b":
                # ESC sequence
                if i + 1 >= n:
                    self._buf = buf[i:]
                    return
                next_ch = buf[i + 1]

                if next_ch == "[":
                    # CSI sequence
                    j = i + 2
                    while j < n and buf[j] not in "ABCDEFGHJKLMPSTXZfhlmnrstu@`":
                        j += 1
                    if j >= n:
                        self._buf = buf[i:]
                        return
                    seq = buf[i + 2 : j]
                    cmd = buf[j]
                    self._handle_csi(seq, cmd)
                    i = j + 1

                elif next_ch == "]":
                    # OSC sequence (title etc)
                    j = i + 2
                    while j < n and buf[j] != "\x07" and not (
                        j + 1 < n and buf[j] == "\x1b" and buf[j + 1] == "\\"
                    ):
                        j += 1
                    if j >= n:
                        self._buf = buf[i:]
                        return
                    osc = buf[i + 2 : j]
                    if buf[j] == "\x07":
                        i = j + 1
                    else:
                        i = j + 2
                    self._handle_osc(osc)

                elif next_ch == "(":
                    # Character set, skip
                    i += 3 if i + 2 < n else n

                elif next_ch == "=":
                    i += 2  # Application keypad mode
                elif next_ch == ">":
                    i += 2  # Normal keypad mode
                elif next_ch == "7":
                    # Save cursor
                    self.saved_cursor = (self.cursor_row, self.cursor_col)
                    i += 2
                elif next_ch == "8":
                    # Restore cursor
                    self.cursor_row, self.cursor_col = self.saved_cursor
                    i += 2
                elif next_ch == "M":
                    # Reverse index
                    self._reverse_index()
                    i += 2
                elif next_ch == "D":
                    # Index (move down)
                    self._index()
                    i += 2
                else:
                    i += 2  # Skip unknown ESC sequence

            elif ch == "\r":
                self.cursor_col = 0
                i += 1
            elif ch == "\n":
                self._index()
                i += 1
            elif ch == "\t":
                # Tab: move to next 8-col stop
                self.cursor_col = min(((self.cursor_col // 8) + 1) * 8, self.cols - 1)
                i += 1
            elif ch == "\x08":
                # Backspace
                self.cursor_col = max(0, self.cursor_col - 1)
                i += 1
            elif ch == "\x07":
                # Bell, ignore
                i += 1
            elif ch == "\x0f" or ch == "\x0e":
                # Shift in/out, ignore
                i += 1
            elif ord(ch) < 0x20:
                # Other control chars, ignore
                i += 1
            else:
                # Printable character
                self._put_char(ch)
                i += 1

        self._buf = ""

    def _put_char(self, ch):
        import unicodedata

        # Check if wide char (CJK)
        width = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1

        if self.cursor_col + width > self.cols:
            # Wrap
            self.cursor_col = 0
            self._index()

        if self.cursor_row < self.rows and self.cursor_col < self.cols:
            self.screen[self.cursor_row][self.cursor_col] = (
                ch,
                self.fg,
                self.bg,
                self.bold,
                self.dim,
                self.italic,
                self.underline,
                self.strikethrough,
                self.inverse,
            )
            if width == 2 and self.cursor_col + 1 < self.cols:
                # Wide char takes 2 cells, mark second as continuation
                self.screen[self.cursor_row][self.cursor_col + 1] = (
                    "",
                    self.fg,
                    self.bg,
                    self.bold,
                    self.dim,
                    self.italic,
                    self.underline,
                    self.strikethrough,
                    self.inverse,
                )
            self.cursor_col += width

    def _index(self):
        """Move cursor down, scroll if at bottom of scroll region."""
        if self.cursor_row == self.scroll_bottom:
            self._scroll_up()
        elif self.cursor_row < self.rows - 1:
            self.cursor_row += 1

    def _reverse_index(self):
        if self.cursor_row == self.scroll_top:
            self._scroll_down()
        elif self.cursor_row > 0:
            self.cursor_row -= 1

    def _scroll_up(self):
        # Save scrolled-off line to SQLite
        scrolled_line = self.screen[self.scroll_top]
        self.scrollback.push_line(scrolled_line)
        row = [self._empty_cell() for _ in range(self.cols)]
        del self.screen[self.scroll_top]
        self.screen.insert(self.scroll_bottom, row)

    def _scroll_down(self):
        row = [self._empty_cell() for _ in range(self.cols)]
        del self.screen[self.scroll_bottom]
        self.screen.insert(self.scroll_top, row)

    def _handle_csi(self, seq, cmd):
        params = []
        if seq:
            for p in seq.replace("?", "").split(";"):
                try:
                    params.append(int(p))
                except ValueError:
                    params.append(0)

        def param(i, default=1):
            return params[i] if i < len(params) and params[i] else default

        if cmd == "A":  # Cursor Up
            self.cursor_row = max(self.scroll_top, self.cursor_row - param(0))
        elif cmd == "B":  # Cursor Down
            self.cursor_row = min(self.scroll_bottom, self.cursor_row + param(0))
        elif cmd == "C":  # Cursor Forward
            self.cursor_col = min(self.cols - 1, self.cursor_col + param(0))
        elif cmd == "D":  # Cursor Back
            self.cursor_col = max(0, self.cursor_col - param(0))
        elif cmd == "E":  # Cursor Next Line
            self.cursor_row = min(self.scroll_bottom, self.cursor_row + param(0))
            self.cursor_col = 0
        elif cmd == "F":  # Cursor Previous Line
            self.cursor_row = max(self.scroll_top, self.cursor_row - param(0))
            self.cursor_col = 0
        elif cmd == "G" or cmd == "`":  # Cursor Horizontal Absolute
            self.cursor_col = max(0, min(self.cols - 1, param(0) - 1))
        elif cmd == "H" or cmd == "f":  # Cursor Position
            self.cursor_row = max(0, min(self.rows - 1, param(0) - 1))
            self.cursor_col = max(0, min(self.cols - 1, param(1, 1) - 1))
        elif cmd == "J":  # Erase in Display
            mode = param(0, 0)
            if mode == 0:  # Below
                for c in range(self.cursor_col, self.cols):
                    self.screen[self.cursor_row][c] = self._empty_cell()
                for r in range(self.cursor_row + 1, self.rows):
                    self.screen[r] = [self._empty_cell() for _ in range(self.cols)]
            elif mode == 1:  # Above
                for r in range(0, self.cursor_row):
                    self.screen[r] = [self._empty_cell() for _ in range(self.cols)]
                for c in range(0, self.cursor_col + 1):
                    self.screen[self.cursor_row][c] = self._empty_cell()
            elif mode == 2 or mode == 3:  # All
                self.screen = self._empty_screen()
        elif cmd == "K":  # Erase in Line
            mode = param(0, 0)
            if mode == 0:
                for c in range(self.cursor_col, self.cols):
                    self.screen[self.cursor_row][c] = self._empty_cell()
            elif mode == 1:
                for c in range(0, self.cursor_col + 1):
                    self.screen[self.cursor_row][c] = self._empty_cell()
            elif mode == 2:
                self.screen[self.cursor_row] = [self._empty_cell() for _ in range(self.cols)]
        elif cmd == "L":  # Insert Lines
            count = param(0)
            for _ in range(count):
                if self.cursor_row <= self.scroll_bottom:
                    del self.screen[self.scroll_bottom]
                    self.screen.insert(self.cursor_row, [self._empty_cell() for _ in range(self.cols)])
        elif cmd == "M":  # Delete Lines
            count = param(0)
            for _ in range(count):
                if self.cursor_row <= self.scroll_bottom:
                    del self.screen[self.cursor_row]
                    self.screen.insert(self.scroll_bottom, [self._empty_cell() for _ in range(self.cols)])
        elif cmd == "P":  # Delete Characters
            count = param(0)
            row = self.screen[self.cursor_row]
            for _ in range(count):
                if self.cursor_col < len(row):
                    row.pop(self.cursor_col)
                    row.append(self._empty_cell())
        elif cmd == "@":  # Insert Characters
            count = param(0)
            row = self.screen[self.cursor_row]
            for _ in range(count):
                row.insert(self.cursor_col, self._empty_cell())
                row.pop()
        elif cmd == "X":  # Erase Characters
            count = param(0)
            for c in range(self.cursor_col, min(self.cursor_col + count, self.cols)):
                self.screen[self.cursor_row][c] = self._empty_cell()
        elif cmd == "S":  # Scroll Up
            for _ in range(param(0)):
                self._scroll_up()
        elif cmd == "T":  # Scroll Down
            for _ in range(param(0)):
                self._scroll_down()
        elif cmd == "d":  # Line Position Absolute
            self.cursor_row = max(0, min(self.rows - 1, param(0) - 1))
        elif cmd == "m":  # SGR (Select Graphic Rendition)
            self._handle_sgr(params if params else [0])
        elif cmd == "r":  # Set Scrolling Region
            self.scroll_top = max(0, param(0) - 1)
            self.scroll_bottom = min(self.rows - 1, param(1, self.rows) - 1)
            self.cursor_row = 0
            self.cursor_col = 0
        elif cmd == "s":  # Save Cursor
            self.saved_cursor = (self.cursor_row, self.cursor_col)
        elif cmd == "u":  # Restore Cursor
            self.cursor_row, self.cursor_col = self.saved_cursor
        elif cmd == "h":  # Set Mode
            if "?" in (seq or ""):
                # Private mode
                if 1049 in params or 47 in params:
                    # Alt screen buffer
                    self.alt_screen = self.screen
                    self.screen = self._empty_screen()
                    self.cursor_row = 0
                    self.cursor_col = 0
        elif cmd == "l":  # Reset Mode
            if "?" in (seq or ""):
                if 1049 in params or 47 in params:
                    if self.alt_screen is not None:
                        self.screen = self.alt_screen
                        self.alt_screen = None
        elif cmd == "n":  # Device Status Report
            pass  # ignore

    def _handle_sgr(self, params):
        i = 0
        while i < len(params):
            p = params[i]
            if p == 0:
                self.fg = self.bg = None
                self.bold = self.dim = self.italic = False
                self.underline = self.strikethrough = self.inverse = False
            elif p == 1:
                self.bold = True
            elif p == 2:
                self.dim = True
            elif p == 3:
                self.italic = True
            elif p == 4:
                self.underline = True
            elif p == 7:
                self.inverse = True
            elif p == 9:
                self.strikethrough = True
            elif p == 22:
                self.bold = self.dim = False
            elif p == 23:
                self.italic = False
            elif p == 24:
                self.underline = False
            elif p == 27:
                self.inverse = False
            elif p == 29:
                self.strikethrough = False
            elif 30 <= p <= 37:
                self.fg = p - 30
            elif p == 38:
                if i + 1 < len(params) and params[i + 1] == 5:
                    self.fg = f"8bit:{params[i + 2]}" if i + 2 < len(params) else None
                    i += 2
                elif i + 1 < len(params) and params[i + 1] == 2:
                    if i + 4 < len(params):
                        self.fg = f"rgb:{params[i+2]},{params[i+3]},{params[i+4]}"
                        i += 4
            elif p == 39:
                self.fg = None
            elif 40 <= p <= 47:
                self.bg = p - 40
            elif p == 48:
                if i + 1 < len(params) and params[i + 1] == 5:
                    self.bg = f"8bit:{params[i + 2]}" if i + 2 < len(params) else None
                    i += 2
                elif i + 1 < len(params) and params[i + 1] == 2:
                    if i + 4 < len(params):
                        self.bg = f"rgb:{params[i+2]},{params[i+3]},{params[i+4]}"
                        i += 4
            elif p == 49:
                self.bg = None
            elif 90 <= p <= 97:
                self.fg = p - 90 + 8
            elif 100 <= p <= 107:
                self.bg = p - 100 + 8
            i += 1

    def _handle_osc(self, osc):
        if osc.startswith("0;") or osc.startswith("2;"):
            self.title = osc.split(";", 1)[1]

    def to_json(self):
        """Convert screen state to JSON for frontend."""
        lines = []
        for r in range(self.rows):
            spans = []
            current_style = None
            text = ""
            for c in range(self.cols):
                cell = self.screen[r][c]
                ch, fg, bg, bold, dim, italic, underline, strike, inverse = cell
                if ch == "":
                    continue  # Skip wide char continuation
                style = (fg, bg, bold, dim, italic, underline, strike, inverse)
                if style != current_style:
                    if text:
                        spans.append(self._make_span(text, current_style))
                    text = ch
                    current_style = style
                else:
                    text += ch
            if text:
                spans.append(self._make_span(text, current_style))
            lines.append(spans)

        return {
            "lines": lines,
            "cursor": {"row": self.cursor_row, "col": self.cursor_col},
            "rows": self.rows,
            "cols": self.cols,
            "title": self.title,
            "scrollback_count": self.scrollback.count,
        }

    def _make_span(self, text, style):
        if style is None:
            return {"t": text}
        fg, bg, bold, dim, italic, underline, strike, inverse = style
        span = {"t": text}
        if fg is not None:
            span["fg"] = self._resolve_color(fg)
        if bg is not None:
            span["bg"] = self._resolve_color(bg)
        if bold:
            span["b"] = True
        if dim:
            span["d"] = True
        if italic:
            span["i"] = True
        if underline:
            span["u"] = True
        if strike:
            span["s"] = True
        if inverse:
            span["inv"] = True
        return span

    def _resolve_color(self, color):
        if isinstance(color, int):
            colors_16 = [
                "#484f58", "#ff7b72", "#3fb950", "#d29922",
                "#58a6ff", "#bc8cff", "#39d353", "#b1bac4",
                "#6e7681", "#ffa198", "#56d364", "#e3b341",
                "#79c0ff", "#d2a8ff", "#56d364", "#f0f6fc",
            ]
            return colors_16[color] if color < 16 else "#c9d1d9"
        if isinstance(color, str):
            if color.startswith("rgb:"):
                parts = color[4:].split(",")
                return f"rgb({parts[0]},{parts[1]},{parts[2]})"
            if color.startswith("8bit:"):
                return self._8bit_to_hex(int(color[5:]))
        return None

    def _8bit_to_hex(self, n):
        if n < 16:
            return self._resolve_color(n)
        if n < 232:
            n -= 16
            r = (n // 36) * 51
            g = ((n % 36) // 6) * 51
            b = (n % 6) * 51
            return f"rgb({r},{g},{b})"
        gray = 8 + (n - 232) * 10
        return f"rgb({gray},{gray},{gray})"


@app.websocket("/ws")
async def terminal_ws(websocket: WebSocket):
    await websocket.accept()

    session_id = id(websocket)

    if len(active_sessions) >= MAX_SESSIONS:
        await websocket.send_text(json.dumps({"error": "max sessions reached"}))
        await websocket.close()
        return

    # Wait for client to send initial size before creating PTY
    init_rows, init_cols = 24, 80
    try:
        init_msg = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        if init_msg.startswith("\x01INIT:"):
            parts = init_msg[6:].split(",")
            if len(parts) == 2:
                init_rows = min(int(parts[0]), MAX_TERMINAL_SIZE)
                init_cols = min(int(parts[1]), MAX_TERMINAL_SIZE)
    except Exception:
        pass

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["LANG"] = "ko_KR.UTF-8"
    env["LC_ALL"] = "ko_KR.UTF-8"

    pid, fd = pty.fork()

    if pid == 0:
        shell = os.environ.get("SHELL", "/bin/zsh")
        os.execvpe(shell, [shell, "-l"], env)

    # Set correct size from the start — no SIGWINCH needed
    set_winsize(fd, init_rows, init_cols)

    active_sessions[session_id] = (pid, fd)
    logger.info("Session %d started (pid=%d, %dx%d, active=%d)", session_id, pid, init_rows, init_cols, len(active_sessions))

    terminal = TerminalState(init_rows, init_cols)

    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    loop = asyncio.get_event_loop()

    async def read_from_pty():
        byte_buf = b""
        try:
            while True:
                future = loop.create_future()

                def on_readable():
                    if not future.done():
                        future.set_result(True)
                    loop.remove_reader(fd)

                loop.add_reader(fd, on_readable)
                try:
                    await future
                except asyncio.CancelledError:
                    loop.remove_reader(fd)
                    raise

                try:
                    data = os.read(fd, 65536)
                    if not data:
                        break
                    byte_buf += data
                    if len(byte_buf) > MAX_BYTE_BUF:
                        byte_buf = byte_buf[-MAX_BYTE_BUF:]
                    # Decode only complete UTF-8 characters
                    text = byte_buf.decode("utf-8")
                    byte_buf = b""
                    terminal.feed(text)
                    state = terminal.to_json()
                    await websocket.send_text(json.dumps(state))
                except UnicodeDecodeError:
                    # Incomplete UTF-8 at the end, keep in buffer
                    # Try to decode as much as possible
                    for trim in range(1, 4):
                        try:
                            text = byte_buf[:-trim].decode("utf-8")
                            byte_buf = byte_buf[-trim:]
                            terminal.feed(text)
                            state = terminal.to_json()
                            await websocket.send_text(json.dumps(state))
                            break
                        except UnicodeDecodeError:
                            continue
                except OSError:
                    break
                except WebSocketDisconnect:
                    break
        except asyncio.CancelledError:
            pass

    read_task = asyncio.create_task(read_from_pty())

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if message["type"] == "websocket.receive":
                if "text" in message:
                    text = message["text"]
                    if text.startswith("\x01RESIZE:"):
                        parts = text[8:].split(",")
                        if len(parts) == 2:
                            rows, cols = int(parts[0]), int(parts[1])
                            terminal.resize(rows, cols)
                            set_winsize(fd, rows, cols)
                            try:
                                os.kill(pid, signal.SIGWINCH)
                            except OSError:
                                pass
                            state = terminal.to_json()
                            await websocket.send_text(json.dumps(state))
                        continue
                    if text == "\x01REFRESH":
                        state = terminal.to_json()
                        await websocket.send_text(json.dumps(state))
                        continue
                    if text.startswith("\x01SCROLLBACK:"):
                        parts = text[12:].split(",")
                        if len(parts) == 2:
                            offset, limit = int(parts[0]), min(int(parts[1]), 200)
                            raw_lines = terminal.scrollback.get_lines(offset, limit)
                            sb_lines = []
                            for cells in raw_lines:
                                spans = []
                                current_style = None
                                t = ""
                                for cell in cells:
                                    ch = cell[0]
                                    if ch == "":
                                        continue
                                    style = tuple(cell[1:])
                                    if style != current_style:
                                        if t:
                                            spans.append(terminal._make_span(t, current_style))
                                        t = ch
                                        current_style = style
                                    else:
                                        t += ch
                                if t:
                                    spans.append(terminal._make_span(t, current_style))
                                sb_lines.append(spans)
                            await websocket.send_text(json.dumps({
                                "scrollback": sb_lines,
                                "offset": offset,
                                "total": terminal.scrollback.count,
                            }))
                        continue
                    try:
                        os.write(fd, text.encode("utf-8"))
                    except OSError:
                        break
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        read_task.cancel()
        try:
            await read_task
        except (asyncio.CancelledError, Exception):
            pass
        terminal.clear()
        cleanup_process(pid, fd)
        active_sessions.pop(session_id, None)
        logger.info("Session %d closed (active=%d)", session_id, len(active_sessions))


def reap_children(signum, frame):
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
        except ChildProcessError:
            break


signal.signal(signal.SIGCHLD, reap_children)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8765)
