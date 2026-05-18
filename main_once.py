# -*- coding: utf-8 -*-
import os, asyncio, re, requests
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

BOT_TOKEN = os.getenv("8834838469:AAF__Pe4Lu3ddUizttOlSARFxn-3UArXEys")
CHAT_ID = os.getenv("-1003539792781")
MY_USER = os.getenv("Earnx098")
MY_PASS = os.getenv("Earnx098")
TARGET_URL = "http://smshadi.net/client/SMSCDRStats"
LOGIN_URL = "http://smshadi.net/login"
FB_URL = "https://tafsir-bot-7983f-default-rtdb.asia-southeast1.firebasedatabase.app/bot"

def update_firebase(num, msg, date_str):
    try:
        url = f"{FB_URL}/sms_logs/{num}.json"
        payload = {"number": num, "message": msg, "time": date_str, "paid": False}
        requests.put(url, json=payload, timeout=5)
        print(f"✅ Firebase updated: {num}")
    except Exception as e:
        print(f"Firebase error: {e}")

async def run_once():
    print("🚀 Fetching OTPs from panel...")
    async with Stealth().use_async(async_playwright()) as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        # লগইন
        try:
            await page.goto(LOGIN_URL, wait_until="networkidle", timeout=60000)
            await page.evaluate(f"""() => {{
                const myUser = "{MY_USER}";
                const myPass = "{MY_PASS}";
                let userField, passField, ansField;
                document.querySelectorAll('input').forEach(inp => {{
                    let p = (inp.placeholder || "").toLowerCase();
                    if (inp.type === 'password') passField = inp;
                    else if (p.includes('user') || inp.type === 'text') {{
                        if (!userField && !p.includes('answer')) userField = inp;
                    }}
                    if (p.includes('answer') || (inp.name || "").includes('ans')) ansField = inp;
                }});
                let match = document.body.innerText.match(/What is\\s+(\\d+)\\s*\\+\\s*(\\d+)/i);
                let sum = match ? (parseInt(match[1]) + parseInt(match[2])) : "";
                if (userField && passField && ansField && sum !== "") {{
                    userField.value = myUser;
                    passField.value = myPass;
                    ansField.value = sum;
                    userField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    passField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    ansField.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    for (let b of document.querySelectorAll('button, input[type="submit"]')) {{
                        if ((b.innerText || b.value || "").toLowerCase().includes('login')) {{
                            b.click();
                            return true;
                        }}
                    }}
                }}
            }}""")
            await page.wait_for_timeout(5000)
        except Exception as e:
            print(f"Login failed: {e}")
            await browser.close()
            return
        # টার্গেট পেজ
        try:
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(3000)
            rows = await page.query_selector_all("table tbody tr")
            new_count = 0
            for row in rows[:5]:  # সর্বোচ্চ ৫টি নতুন মেসেজ নিবে
                cols = await row.query_selector_all("td")
                if len(cols) >= 7:
                    date = (await cols[0].inner_text()).strip()
                    number = (await cols[2].inner_text()).strip()
                    sms = (await cols[4].inner_text()).strip()
                    cli = (await cols[3].inner_text()).strip()
                    if date and len(re.sub(r'\D', '', number)) >= 8:
                        update_firebase(number, sms, date)
                        new_count += 1
            print(f"✅ {new_count} new SMS pushed to Firebase")
        except Exception as e:
            print(f"Scrape error: {e}")
        finally:
            await browser.close()
    print("✅ Scrape finished")

if __name__ == "__main__":
    asyncio.run(run_once())
