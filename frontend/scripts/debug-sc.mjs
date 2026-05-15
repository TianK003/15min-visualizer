import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
p.on("console", m => console.log("  " + m.type() + ":", m.text().slice(0, 250)));
p.on("pageerror", e => console.log("  pageerror:", e.message));
p.on("requestfailed", r => console.log("  reqfail:", r.url().slice(0, 150), r.failure()?.errorText));
p.on("requestfinished", r => {
  const u = r.url();
  if (u.includes("127.0.0.1:54321")) {
    r.response().then(resp => console.log("  " + resp.status() + " " + r.method() + " " + u.slice(0, 200))).catch(() => {});
  }
});
await p.goto("http://localhost:3000/#lng=14.5061&lat=46.0512&z=14&h3=8a1e1216b367fff", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(8000);
const html = await p.evaluate(() => document.querySelector(".scorecard")?.innerHTML || "NO SCORECARD");
console.log("--- scorecard DOM (first 600 chars) ---");
console.log(html.slice(0, 600));
await b.close();
