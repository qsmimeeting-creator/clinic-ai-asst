import fetch from 'node-fetch';

async function run() {
  console.log('Optimizing files...');
  try {
    const res = await fetch('http://localhost:3000/api/admin/optimize-files', {
      method: 'POST'
    });
    const data = await res.json();
    console.log('Result:', data);
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
