import fetch from 'node-fetch';

async function test() {
  try {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    
    // Replace with local URL since this is running from command line
    const url = `http://localhost:8080/api/ops/state?from=${encodeURIComponent(iso)}`;
    console.log(`Fetching from: ${url}`);
    
    const res = await fetch(url);
    if (!res.ok) {
      console.log('Error HTTP:', res.status, await res.text());
      return;
    }
    const data = await res.json();
    console.log('Vuelos count:', data.vuelos ? data.vuelos.length : 0);
    if (data.vuelos && data.vuelos.length > 0) {
      console.log('Sample vuelo:', data.vuelos[0]);
      const activos = data.vuelos.filter(v => v.enUso);
      console.log('Activos count:', activos.length);
    }
  } catch (err) {
    console.error(err);
  }
}
test();
