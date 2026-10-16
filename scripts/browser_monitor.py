"""Browser smoke check against scripts.preview_monitor, using synthetic data."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8017/port5000/")
parser.add_argument("--browser", help="optional Chromium executable")
parser.add_argument("--output", default="artifacts/screenshots")
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({"executable_path": args.browser} if args.browser else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1100}, color_scheme="light")
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(args.url)
    expect(page.get_by_role("tab", name="Skipjack details")).to_be_visible()
    # An unavailable overview must not block the detailed view.
    page.get_by_role("tab", name="Skipjack details").click()
    expect(page.get_by_role("heading", name="Accounts", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="GPU pools", exact=True)).to_be_visible()
    page.get_by_label("User perspective").select_option("viewer")
    expect(page.get_by_text("viewer FS", exact=True).first).to_be_visible()
    page.get_by_role("button", name="24h", exact=True).click()
    page.get_by_role("button", name="Tracked accounts", exact=True).click()
    page.get_by_role("button", name="Table", exact=True).first.click()
    expect(page.locator(".cluster-trends table").first).to_be_visible()
    page.get_by_role("button", name="Chart", exact=True).first.click()
    page.get_by_role("button", name="Collect now", exact=True).click()
    expect(page.get_by_role("button", name="Collect now", exact=True)).to_be_enabled()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "desktop horizontal overflow"
    page.screenshot(path=str(out / "skipjack-light.png"), full_page=True)
    page.get_by_role("button", name="Toggle dark mode").click()
    expect(page.locator("html")).to_have_class("dark")
    page.screenshot(path=str(out / "skipjack-dark.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "mobile horizontal overflow"
    page.screenshot(path=str(out / "skipjack-mobile.png"), full_page=True)
    page.reload()
    expect(page.get_by_role("tab", name="Skipjack details")).to_have_attribute("data-state", "active")
    expect(page.get_by_label("User perspective")).to_have_value("viewer")
    page.get_by_label("User perspective").select_option("")
    expect(page.get_by_text("Account FS", exact=True).first).to_be_visible()
    page.get_by_role("tab", name="Overview", exact=True).click()
    expect(page.get_by_text("Offline preview: overview collectors are disabled").first).to_be_visible()
    assert not errors, errors
    print(json.dumps({"url": args.url, "desktop": True, "mobile": True, "themes": ["light", "dark"],
                      "user_selection": True, "filters": True, "refresh": True, "page_errors": errors}))
    browser.close()
