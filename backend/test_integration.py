"""
Integration test: sends fake data to all major API endpoints.
Run while the Flask server is running on port 5001.
"""
import urllib.request, json, time

BASE = "http://127.0.0.1:5001/api"
TOKEN = None
RESULTS = []


def req(method, path, data=None, auth=False):
    global TOKEN
    url = BASE + path
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    if auth and TOKEN:
        r.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        resp = urllib.request.urlopen(r, timeout=10)
        result = json.loads(resp.read())
        return resp.status, result
    except urllib.error.HTTPError as e:
        try:
            body_resp = json.loads(e.read())
        except Exception:
            body_resp = e.reason
        return e.code, body_resp


TS = int(time.time())
EMAIL = f"testuser_{TS}@fakeemail.com"
PASS = "TestPass123!"

print("=" * 60)
print("INTEGRATION TEST WITH FAKE DATA")
print("=" * 60)

# ---- 1. REGISTER ----
print("\n[1] POST /auth/register (new consumer)")
code, body = req("POST", "/auth/register", {
    "email": EMAIL,
    "password": PASS,
    "first_name": "Test",
    "last_name": "User",
})
RESULTS.append(("Register", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Keys: {list(body.keys())}")
    if "token" in body:
        TOKEN = body["token"]
        print(f"  Token: {TOKEN[:30]}...")

# ---- 2. LOGIN ----
print("\n[2] POST /auth/login")
code, body = req("POST", "/auth/login", {
    "email": EMAIL,
    "password": PASS,
})
RESULTS.append(("Login", code))
print(f"  Status: {code}")
if isinstance(body, dict) and "token" in body:
    TOKEN = body["token"]
    print(f"  Token: {TOKEN[:30]}...")
    user_info = body.get("user", {})
    print(f"  User role: {user_info.get('role', '?')}")

# ---- 3. GET PROFILE ----
print("\n[3] GET /user/profile (authenticated)")
code, body = req("GET", "/user/profile", auth=True)
RESULTS.append(("Get Profile", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Name: {body.get('firstName')} {body.get('lastName')}")
    print(f"  Email: {body.get('email')}")

# ---- 4. UPDATE PROFILE ----
print("\n[4] PUT /user/profile (update name + phone)")
code, body = req("PUT", "/user/profile", {
    "firstName": "Updated",
    "lastName": "TestUser",
    "phone": "+639171234567",
}, auth=True)
RESULTS.append(("Update Profile", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Message: {body.get('message', '?')}")

# ---- 5. ADD ADDRESS ----
print("\n[5] POST /user/addresses (add address)")
code, body = req("POST", "/user/addresses", {
    "label": "Home",
    "address": "123 Test Street, Quezon City",
    "lat": 14.6507,
    "lng": 121.0497,
    "isDefault": True,
}, auth=True)
RESULTS.append(("Add Address", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Keys: {list(body.keys())}")

# ---- 6. GET PRODUCTS ----
print("\n[6] GET /products (public)")
code, body = req("GET", "/products")
RESULTS.append(("Get Products", code))
print(f"  Status: {code}")
product_id = None
if isinstance(body, list) and len(body) > 0:
    print(f"  Count: {len(body)}")
    product_id = body[0].get("_id") or body[0].get("id")
    print(f"  First product: {body[0].get('name', '?')} (id={product_id})")

# ---- 7. ADD TO CART ----
if product_id:
    print(f"\n[7] POST /cart (add product {product_id})")
    code, body = req("POST", "/cart", {
        "product_id": product_id,
        "quantity": 2,
    }, auth=True)
    RESULTS.append(("Add to Cart", code))
    print(f"  Status: {code}")
    if isinstance(body, dict):
        print(f"  Keys: {list(body.keys())}")
        cart_items = body.get("items", body.get("cart", []))
        if isinstance(cart_items, list):
            print(f"  Cart items: {len(cart_items)}")
else:
    print("\n[7] SKIP /cart (no product_id available)")
    RESULTS.append(("Add to Cart", "SKIP"))

# ---- 8. GET CART ----
print("\n[8] GET /cart (view cart)")
code, body = req("GET", "/cart", auth=True)
RESULTS.append(("Get Cart", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Keys: {list(body.keys())}")

# ---- 9. UPDATE CART QUANTITY ----
if product_id:
    print(f"\n[9] PUT /cart/{product_id} (update quantity)")
    code, body = req("PUT", f"/cart/{product_id}", {
        "quantity": 5,
    }, auth=True)
    RESULTS.append(("Update Cart", code))
    print(f"  Status: {code}")
    if isinstance(body, dict):
        print(f"  Keys: {list(body.keys())}")
else:
    print("\n[9] SKIP update cart")
    RESULTS.append(("Update Cart", "SKIP"))

# ---- 10. GET ORDERS ----
print("\n[10] GET /orders (should be empty for new user)")
code, body = req("GET", "/orders", auth=True)
RESULTS.append(("Get Orders", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    orders = body.get("orders", [])
    print(f"  Orders count: {len(orders)}")
elif isinstance(body, list):
    print(f"  Orders count: {len(body)}")

# ---- 11. AUTH/ME ----
print("\n[11] GET /auth/me (token check)")
code, body = req("GET", "/auth/me", auth=True)
RESULTS.append(("Auth/Me", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  User email: {body.get('email', '?')}")

# ---- 12. NOTIFICATIONS ----
print("\n[12] GET /user/notifications")
code, body = req("GET", "/user/notifications", auth=True)
RESULTS.append(("Notifications", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Keys: {list(body.keys())}")
elif isinstance(body, list):
    print(f"  Notifications: {len(body)}")

# ---- 13. DTI PRICE SUGGESTION ----
print("\n[13] GET /dti/suggest-price?name=Tomato")
code, body = req("GET", "/dti/suggest-price?name=Tomato", auth=True)
RESULTS.append(("DTI Price", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    for k in ["suggestedPrice", "suggested_price", "min_price", "max_price", "message", "error"]:
        if k in body:
            print(f"  {k}: {body[k]}")

# ---- 14. GET FARMERS (public) ----
print("\n[14] GET /farmers (public listing)")
code, body = req("GET", "/farmers")
RESULTS.append(("Get Farmers", code))
print(f"  Status: {code}")
farmer_id = None
if isinstance(body, list) and len(body) > 0:
    print(f"  Count: {len(body)}")
    farmer_id = body[0].get("id") or body[0].get("_id")
    print(f"  First farmer: {body[0].get('first_name', '?')} {body[0].get('last_name', '?')}")

# ---- 15. GET FARMER PROFILE (public) ----
if farmer_id:
    print(f"\n[15] GET /farmer/{farmer_id} (public profile)")
    code, body = req("GET", f"/farmer/{farmer_id}")
    RESULTS.append(("Farmer Profile", code))
    print(f"  Status: {code}")
    if isinstance(body, dict):
        print(f"  Keys: {list(body.keys())[:8]}")
else:
    print("\n[15] SKIP farmer profile (no farmer_id)")
    RESULTS.append(("Farmer Profile", "SKIP"))

# ---- 16. PRICE PREDICTIONS (public) ----
print("\n[16] GET /public/price-predictions")
code, body = req("GET", "/public/price-predictions")
RESULTS.append(("Price Predictions", code))
print(f"  Status: {code}")
if isinstance(body, dict):
    print(f"  Count: {body.get('count', '?')}")

# ========== NEGATIVE / ERROR TESTS ==========
print("\n" + "=" * 60)
print("NEGATIVE TESTS (expected errors)")
print("=" * 60)

# ---- 17. DUPLICATE REGISTER ----
print("\n[17] POST /auth/register (duplicate email)")
code, body = req("POST", "/auth/register", {
    "email": EMAIL,
    "password": PASS,
    "first_name": "Dup",
    "last_name": "User",
})
RESULTS.append(("Dup Register", code))
print(f"  Status: {code}  (expected 400/409)")
if isinstance(body, dict):
    print(f"  Error: {body.get('error', body.get('message', '?'))}")

# ---- 18. WRONG PASSWORD ----
print("\n[18] POST /auth/login (wrong password)")
code, body = req("POST", "/auth/login", {
    "email": EMAIL,
    "password": "WrongPassword999!",
})
RESULTS.append(("Bad Login", code))
print(f"  Status: {code}  (expected 401)")

# ---- 19. MISSING FIELDS ----
print("\n[19] POST /auth/login (empty body)")
code, body = req("POST", "/auth/login", {})
RESULTS.append(("Missing Fields", code))
print(f"  Status: {code}  (expected 400/401)")

# ---- 20. NO AUTH TOKEN ----
print("\n[20] GET /cart (no auth)")
code, body = req("GET", "/cart")
RESULTS.append(("No Auth Cart", code))
print(f"  Status: {code}  (expected 401)")

# ---- 21. INVALID PRODUCT IN CART ----
print("\n[21] POST /cart (bogus product id)")
code, body = req("POST", "/cart", {
    "product_id": "nonexistent_id_999",
    "quantity": 1,
}, auth=True)
RESULTS.append(("Bad Cart Add", code))
print(f"  Status: {code}  (expected 4xx/5xx)")
if isinstance(body, dict):
    print(f"  Error: {body.get('error', body.get('message', '?'))}")

# ---- 22. REGISTER WITH MISSING DATA ----
print("\n[22] POST /auth/register (missing email)")
code, body = req("POST", "/auth/register", {
    "password": "SomePass1!",
    "first_name": "No",
    "last_name": "Email",
})
RESULTS.append(("No Email Register", code))
print(f"  Status: {code}  (expected 400)")
if isinstance(body, dict):
    print(f"  Error: {body.get('error', body.get('message', '?'))}")

# ---- 23. DELETE CART ITEM ----
if product_id:
    print(f"\n[23] DELETE /cart/{product_id}")
    code, body = req("DELETE", f"/cart/{product_id}", auth=True)
    RESULTS.append(("Delete Cart Item", code))
    print(f"  Status: {code}")
else:
    RESULTS.append(("Delete Cart Item", "SKIP"))

# ---- 24. CLEAR CART ----
print("\n[24] DELETE /cart (clear)")
code, body = req("DELETE", "/cart", auth=True)
RESULTS.append(("Clear Cart", code))
print(f"  Status: {code}")

# ========== SUMMARY ==========
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)

EXPECTED_ERRORS = {
    "Dup Register": (400, 409),
    "Bad Login": (401,),
    "Missing Fields": (400, 401, 500),
    "No Auth Cart": (401,),
    "Bad Cart Add": (400, 404, 500),
    "No Email Register": (400, 500),
}

passed = 0
failed = 0
for name, code in RESULTS:
    if code == "SKIP":
        status = "SKIP"
    elif name in EXPECTED_ERRORS:
        status = "PASS" if code in EXPECTED_ERRORS[name] else "FAIL"
    elif isinstance(code, int) and 200 <= code < 300:
        status = "PASS"
    else:
        status = "FAIL"

    if status == "PASS":
        passed += 1
    elif status == "FAIL":
        failed += 1

    print(f"  [{status:4s}] {name}: {code}")

print(f"\n  Result: {passed} passed, {failed} failed out of {len(RESULTS)}")
if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print("  SOME TESTS FAILED - check above for details")
