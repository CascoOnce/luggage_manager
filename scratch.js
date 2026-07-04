import { api } from './src/services/api.js';

async function test() {
  const airports = await api.getAirports();
  console.log(airports.map(a => a.ocupacionActual));
}
test();
