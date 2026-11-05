import http from 'node:http';
import url from 'node:url';

export interface SeededDefects {
  DEFECT_WRONG_TOTAL: boolean;
  DEFECT_INVALID_PAYMENT_ACCEPTED: boolean;
  DEFECT_MISSING_VALIDATION: boolean;
  DEFECT_WRONG_RECORD_UPDATED: boolean;
  DEFECT_UNAUTHORIZED_ACTION: boolean;
  DEFECT_INCORRECT_WORKFLOW: boolean;
}

export interface UiMutations {
  accessibleNameDrift: boolean;
  testIdRemoved: boolean;
  domRestructure: boolean;
  duplicateControls: boolean;
}

export class ControlledAppServer {
  private server: http.Server | null = null;
  public port = 4173;

  public defects: SeededDefects = {
    DEFECT_WRONG_TOTAL: false,
    DEFECT_INVALID_PAYMENT_ACCEPTED: false,
    DEFECT_MISSING_VALIDATION: false,
    DEFECT_WRONG_RECORD_UPDATED: false,
    DEFECT_UNAUTHORIZED_ACTION: false,
    DEFECT_INCORRECT_WORKFLOW: false,
  };

  public mutations: UiMutations = {
    accessibleNameDrift: false,
    testIdRemoved: false,
    domRestructure: false,
    duplicateControls: false,
  };

  // In-memory reproducible state
  public users = [
    { id: 'usr-1', email: 'admin@example.com', name: 'System Admin', role: 'admin' },
    { id: 'usr-2', email: 'customer@example.com', name: 'John Doe', role: 'customer' },
  ];

  public products = [
    { id: 'prod-1', name: 'Playwright Pro Engine', price: 99.0, category: 'Software' },
    { id: 'prod-2', name: 'Enterprise Cloud Runner', price: 499.0, category: 'Infrastructure' },
    { id: 'prod-3', name: 'CI/CD Automation Probe', price: 29.0, category: 'Hardware' },
  ];

  public cart: Array<{ productId: string; quantity: number }> = [
    { productId: 'prod-1', quantity: 1 },
  ];

  public orders = [
    { id: 'ORD-101', customerEmail: 'customer@example.com', total: 99.0, status: 'PENDING' },
  ];

  public reset(): void {
    this.defects = {
      DEFECT_WRONG_TOTAL: false,
      DEFECT_INVALID_PAYMENT_ACCEPTED: false,
      DEFECT_MISSING_VALIDATION: false,
      DEFECT_WRONG_RECORD_UPDATED: false,
      DEFECT_UNAUTHORIZED_ACTION: false,
      DEFECT_INCORRECT_WORKFLOW: false,
    };
    this.mutations = {
      accessibleNameDrift: false,
      testIdRemoved: false,
      domRestructure: false,
      duplicateControls: false,
    };
    this.users = [
      { id: 'usr-1', email: 'admin@example.com', name: 'System Admin', role: 'admin' },
      { id: 'usr-2', email: 'customer@example.com', name: 'John Doe', role: 'customer' },
    ];
    this.cart = [{ productId: 'prod-1', quantity: 1 }];
    this.orders = [
      { id: 'ORD-101', customerEmail: 'customer@example.com', total: 99.0, status: 'PENDING' },
    ];
  }

  public async start(port = 4173): Promise<number> {
    this.port = port;
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, () => {
        resolve(this.port);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsed = url.parse(req.url ?? '/', true);
    const pathname = parsed.pathname ?? '/';

    // Allow defect override via header
    const headerDefect = req.headers['x-seeded-defect'] as keyof SeededDefects | undefined;
    if (headerDefect && headerDefect in this.defects) {
      this.defects[headerDefect] = true;
    }

    // CORS & Common Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-seeded-defect');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API Routes
    if (pathname === '/api/reset' && req.method === 'POST') {
      this.reset();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'State reset to initial seed' }));
      return;
    }

    if (pathname === '/api/defects') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            this.defects = { ...this.defects, ...data };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.defects));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.defects));
      return;
    }

    if (pathname === '/api/mutations') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            this.mutations = { ...this.mutations, ...data };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.mutations));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.mutations));
      return;
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { username, password } = JSON.parse(body);
          if (username === 'admin@example.com' && password === 'admin123') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: 'jwt-admin-token', user: this.users[0] }));
          } else if (username === 'customer@example.com' && password === 'pass123') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: 'jwt-customer-token', user: this.users[1] }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Malformed request' }));
        }
      });
      return;
    }

    if (pathname === '/api/checkout' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const { cardNumber, shippingAddress } = payload;

          // Seeded Defect 1: Invalid payment accepted
          if (!this.defects.DEFECT_INVALID_PAYMENT_ACCEPTED) {
            if (!cardNumber || cardNumber.startsWith('0000') || cardNumber.length < 12) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payment declined: invalid credit card number' }));
              return;
            }
          }

          // Seeded Defect 3: Missing required validation accepted
          if (!this.defects.DEFECT_MISSING_VALIDATION) {
            if (!shippingAddress || shippingAddress.trim() === '') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Validation failed: shipping address is required' }));
              return;
            }
          }

          // Seeded Defect 2: Incorrect order total calculated
          let orderTotal = 99.0;
          if (this.defects.DEFECT_WRONG_TOTAL) {
            orderTotal = 199.0; // Incorrect calculation defect
          }

          const newOrder = {
            id: `ORD-${Date.now().toString().slice(-4)}`,
            customerEmail: 'customer@example.com',
            total: orderTotal,
            status: 'PAID',
          };
          this.orders.push(newOrder);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, order: newOrder }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Malformed request' }));
        }
      });
      return;
    }

    if (pathname === '/api/users/update' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { userId, newName } = JSON.parse(body);

          // Seeded Defect 4: Wrong record updated
          let targetIndex = this.users.findIndex((u) => u.id === userId);
          if (this.defects.DEFECT_WRONG_RECORD_UPDATED) {
            targetIndex = targetIndex === 0 ? 1 : 0; // Deliberately update the wrong user!
          }

          if (targetIndex >= 0 && this.users[targetIndex]) {
            this.users[targetIndex]!.name = newName;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, user: this.users[targetIndex] }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User not found' }));
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Malformed request' }));
        }
      });
      return;
    }

    // HTML Page Views
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this.renderHtml(pathname));
  }

  private renderHtml(pathname: string): string {
    const isDrift = this.mutations.accessibleNameDrift;
    const isTestIdRemoved = this.mutations.testIdRemoved;

    const loginButtonLabel = isDrift ? 'Sign In Now' : 'Sign In';
    const placeOrderLabel = isDrift ? 'Confirm & Pay' : 'Place Order';
    const testIdAttr = isTestIdRemoved ? '' : 'data-testid="submit-btn"';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Controlled Enterprise Benchmark App</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; background: #f8fafc; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    nav a { margin-right: 1.5rem; text-decoration: none; color: #2563eb; font-weight: 600; }
    button { background: #2563eb; color: white; padding: 0.6rem 1.2rem; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #1d4ed8; }
    input { padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; width: 100%; box-sizing: border-box; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e2e8f0; }
    .banner { background: #eff6ff; border-left: 4px solid #2563eb; padding: 1rem; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <nav>
      <a href="/">Dashboard</a>
      <a href="/login">Login</a>
      <a href="/products">Products</a>
      <a href="/cart">Cart (<span id="cart-count">${this.cart.length}</span>)</a>
      <a href="/checkout">Checkout</a>
      <a href="/orders">Orders</a>
      <a href="/admin/users">Users</a>
    </nav>
    <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid #e2e8f0;" />

    ${this.renderPageBody(pathname, loginButtonLabel, placeOrderLabel, testIdAttr)}
  </div>
</body>
</html>`;
  }

  private renderPageBody(
    pathname: string,
    loginBtnText: string,
    placeOrderBtnText: string,
    testIdAttr: string
  ): string {
    if (pathname === '/login') {
      return `
        <h2>User Login</h2>
        <form id="login-form" onsubmit="event.preventDefault(); handleLogin();">
          <label for="username">Email Address</label>
          <input type="email" id="username" name="username" value="admin@example.com" required />
          <label for="password">Password</label>
          <input type="password" id="password" name="password" value="admin123" required />
          <button type="submit" id="btn-login" role="button" aria-label="${loginBtnText}" ${testIdAttr}>${loginBtnText}</button>
        </form>
        <div id="login-status" style="margin-top: 1rem;"></div>
        <script>
          async function handleLogin() {
            const u = document.getElementById('username').value;
            const p = document.getElementById('password').value;
            const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
            const data = await res.json();
            const status = document.getElementById('login-status');
            if (res.ok) {
              status.innerHTML = '<span style="color: green;">Login Successful! Logged in as ' + data.user.name + '</span>';
            } else {
              status.innerHTML = '<span style="color: red;">Login Failed: ' + data.error + '</span>';
            }
          }
        </script>
      `;
    }

    if (pathname === '/checkout') {
      const orderTotal = this.defects.DEFECT_WRONG_TOTAL ? 199.0 : 99.0;
      return `
        <h2>Order Checkout</h2>
        <div class="banner">
          Order Subtotal: <strong id="order-total" data-testid="order-total">$${orderTotal.toFixed(2)}</strong>
        </div>
        <form id="checkout-form" onsubmit="event.preventDefault(); handleCheckout();">
          <label for="card">Card Number</label>
          <input type="text" id="card" placeholder="4532 0150 9988 1234" value="4532015099881234" required />
          <label for="address">Shipping Address</label>
          <input type="text" id="address" placeholder="123 Test Street" value="123 Test St, Silicon Valley, CA" required />
          <button type="submit" id="btn-checkout" role="button" aria-label="${placeOrderBtnText}" ${testIdAttr}>${placeOrderBtnText}</button>
        </form>
        <div id="checkout-result" style="margin-top: 1rem;"></div>
        <script>
          async function handleCheckout() {
            const card = document.getElementById('card').value;
            const addr = document.getElementById('address').value;
            const res = await fetch('/api/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cardNumber: card, shippingAddress: addr })
            });
            const data = await res.json();
            const result = document.getElementById('checkout-result');
            if (res.ok) {
              result.innerHTML = '<div style="color: green; font-size: 1.2rem;">Order Confirmed: ' + data.order.id + ' Total: $' + data.order.total.toFixed(2) + '</div>';
            } else {
              result.innerHTML = '<div style="color: red;">Checkout Failed: ' + data.error + '</div>';
            }
          }
        </script>
      `;
    }

    if (pathname === '/admin/users') {
      return `
        <h2>User Management</h2>
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${this.users
              .map(
                (u) => `<tr>
                  <td>${u.id}</td>
                  <td id="name-${u.id}">${u.name}</td>
                  <td>${u.email}</td>
                  <td>${u.role}</td>
                  <td>
                    <button onclick="editUser('${u.id}')" aria-label="Edit ${u.name}">Edit</button>
                  </td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
        <div id="admin-status" style="margin-top: 1rem;"></div>
        <script>
          async function editUser(id) {
            const newName = prompt('Enter new user name:');
            if (!newName) return;
            const res = await fetch('/api/users/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: id, newName })
            });
            const data = await res.json();
            if (res.ok) {
              location.reload();
            }
          }
        </script>
      `;
    }

    // Default: Dashboard / Product catalog
    return `
      <h2>Product Catalog</h2>
      <table>
        <thead><tr><th>Product</th><th>Price</th><th>Category</th><th>Action</th></tr></thead>
        <tbody>
          ${this.products
            .map(
              (p) => `<tr>
                <td><strong>${p.name}</strong></td>
                <td>$${p.price.toFixed(2)}</td>
                <td>${p.category}</td>
                <td><button aria-label="Add ${p.name} to Cart">Add to Cart</button></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }
}

