import "dotenv/config";

async function test() {
  try {
    const res = await fetch("http://localhost:3000/api/data");
    console.log(await res.json());
  } catch (e) {
    console.error(e);
  }
}

test();
