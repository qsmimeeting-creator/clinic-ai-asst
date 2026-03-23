import "dotenv/config";

async function test() {
  try {
    const res = await fetch("http://localhost:3000/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test.jpg",
        category: "cat_test",
        mimeType: "image/jpeg",
        inlineData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        size: 100,
        date: new Date().toISOString()
      })
    });
    console.log(await res.json());
  } catch (e) {
    console.error(e);
  }
}

test();
