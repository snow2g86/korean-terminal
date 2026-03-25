/* =============================================================
   하드웨어 모니터링
   ============================================================= */

function barColor(pct) { return pct < 50 ? '#3fb950' : pct < 80 ? '#d29922' : '#f85149'; }
function padPct(n) { var s = n.toFixed(1); while (s.length < 5) s = ' ' + s; return s; }

async function updateHwInfo() {
  try {
    var d = await window.terminal.getSysinfo();
    document.getElementById('hwCpuSpec').textContent = d.cpu.cores_physical + 'C/' + d.cpu.cores_logical + 'T';
    var cb = document.getElementById('hwCpuBar');
    cb.style.width = d.cpu.percent + '%';
    cb.style.background = barColor(d.cpu.percent);
    document.getElementById('hwCpuText').textContent = padPct(d.cpu.percent) + '%';

    document.getElementById('hwMemSpec').textContent = d.memory.total_gb + 'GB';
    var mb = document.getElementById('hwMemBar');
    mb.style.width = d.memory.percent + '%';
    mb.style.background = barColor(d.memory.percent);
    document.getElementById('hwMemText').textContent = padPct(d.memory.percent) + '%';

    var db = document.getElementById('hwDiskBar');
    db.style.width = d.disk.percent + '%';
    db.style.background = barColor(d.disk.percent);
    document.getElementById('hwDiskText').textContent = padPct(d.disk.percent) + '%';

    document.getElementById('hwNetVal').textContent = '\u2191' + d.network.sent_mbs + 'MB/s \u2193' + d.network.recv_mbs + 'MB/s';
    document.getElementById('hwOsInfo').textContent = d.hostname + ' \u00b7 ' + d.os;
  } catch (e) {}
}

updateHwInfo();
setInterval(updateHwInfo, 2000);
