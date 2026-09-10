const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const el = (id) => document.getElementById(id);

let tenants = [];
let current = null;
let health = {};
let lastGood = null;

function setBeat() {
  const beat = el("beat");
  const seen = el("lastseen");
  if (!lastGood) {
    beat.className = "beat dead";
    seen.textContent = "no data";
    return;
  }
  const age = Math.round((Date.now() - lastGood) / 1000);
  beat.className = age > 20 ? "beat dead" : age > 10 ? "beat stale" : "beat";
  seen.textContent = age < 6 ? "live" : `${age}s ago`;
}
setInterval(setBeat, 1000);

function showDiag(title, body, hint, raw) {
  el("app").classList.add("hide");
  const d = el("diag");
  d.classList.remove("hide");
  d.innerHTML = "";

  const h = document.createElement("h3");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;
  d.append(h, p);

  if (raw) {
    const pre = document.createElement("pre");
    pre.textContent = raw;
    d.appendChild(pre);
  }
  if (hint && hint.length) {
    const ul = document.createElement("ul");
    for (const item of hint) {
      const li = document.createElement("li");
      li.innerHTML = item;
      ul.appendChild(li);
    }
    d.appendChild(ul);
  }
}

function clearDiag() {
  el("diag").classList.add("hide");
  el("app").classList.remove("hide");
}

function interpret(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("could not load credentials") || m.includes("credential")) {
    return {
      title: "No AWS credentials",
      body: "The server started but cannot authenticate to AWS.",
      hint: [
        "Set your profile: <code>export AWS_PROFILE=kerbside-demo</code>",
        "Check it works: <code>aws sts get-caller-identity</code>",
        "Restart the server after changing the profile"
      ]
    };
  }
  if (m.includes("resourcenotfound") || m.includes("non-existent table")) {
    return {
      title: "DynamoDB table not found",
      body: "The table named in your configuration does not exist in this region.",
      hint: [
        "Run <code>npm run seed</code> to create it",
        "Check <code>AWS_REGION</code> matches where the table lives",
        "Check <code>KERBSIDE_TABLE</code> if you renamed it"
      ]
    };
  }
  if (m.includes("nosuchbucket")) {
    return {
      title: "S3 bucket not found",
      body: "Order data may still load, but menu assets cannot be read.",
      hint: [
        "Confirm <code>KERBSIDE_BUCKET</code> is set to your bucket",
        "Bucket names are globally unique — yours must differ from the default"
      ]
    };
  }
  if (m.includes("accessdenied") || m.includes("not authorized")) {
    return {
      title: "Access denied",
      body: "Credentials are valid but the principal lacks permission for this call.",
      hint: [
        "Needs DynamoDB Query and S3 GetObject plus ListBucket",
        "Check you are using the sandbox profile, not a production one"
      ]
    };
  }
  if (m.includes("throughput") || m.includes("throttl")) {
    return {
      title: "Request throttled",
      body: "DynamoDB is rate limiting. This usually clears within a few seconds.",
      hint: ["The dashboard will retry automatically on the next poll"]
    };
  }
  if (m.includes("failed to fetch") || m.includes("networkerror")) {
    return {
      title: "Local server unreachable",
      body: "The browser cannot reach the Node server on this machine.",
      hint: ["Check the terminal running <code>npm start</code> is still alive"]
    };
  }
  return {
    title: "Unable to load tenant data",
    body: "The server returned an error while reading from AWS.",
    hint: ["Check the terminal running <code>npm start</code> for the full stack trace"]
  };
}

function renderRail() {
  const rail = el("rail");
  rail.innerHTML = "";
  for (const t of tenants) {
    const b = document.createElement("button");
    b.className = "tenant";
    b.setAttribute("aria-current", String(t.slug === current));

    const pip = document.createElement("span");
    const state = health[t.slug];
    pip.className = "pip " + (state === undefined ? "unknown" : state ? "" : "bad");
    const label = document.createElement("span");
    label.textContent = t.name;

    b.append(pip, label);
    b.addEventListener("click", () => {
      current = t.slug;
      renderRail();
      refresh();
    });
    rail.appendChild(b);
  }
  el("shown").textContent = tenants.length;
}

function renderGallery(menu) {
  const g = el("gallery");
  g.innerHTML = "";
  for (const m of menu) {
    const tile = document.createElement("div");
    tile.className = "tile";

    if (m.imagePresent) {
      const img = document.createElement("img");
      img.src = m.imageUrl;
      img.alt = m.name;
      tile.appendChild(img);
    } else {
      const gone = document.createElement("div");
      gone.className = "gone";
      const big = document.createElement("div");
      big.className = "big";
      big.textContent = "404";
      const sub = document.createElement("div");
      sub.textContent = "object not found";
      gone.append(big, sub);
      tile.appendChild(gone);
    }

    const cap = document.createElement("div");
    cap.className = "cap";
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = m.name;
    const p = document.createElement("span");
    p.className = "p";
    p.textContent = gbp.format(m.price);
    cap.append(n, p);
    tile.appendChild(cap);
    g.appendChild(tile);
  }
}

function renderOrders(orders) {
  const body = el("orders");
  body.innerHTML = "";
  for (const o of orders.slice(0, 12)) {
    const tr = document.createElement("tr");
    if (o.corrupt) tr.className = "bad";

    const id = document.createElement("td");
    id.className = "oid";
    id.textContent = `#${o.orderId}`;

    const item = document.createElement("td");
    item.textContent = `${o.itemName} × ${o.quantity}`;

    const mods = document.createElement("td");
    if (o.modifiers && o.modifiers.length) {
      mods.textContent = o.modifiers.join(", ");
    } else if (o.corrupt) {
      mods.innerHTML = '<span class="pill flag">modifiers missing</span>';
    } else {
      mods.innerHTML = '<span class="dim">none</span>';
    }

    const st = document.createElement("td");
    st.innerHTML = `<span class="pill">${o.status}</span>`;

    const money = document.createElement("td");
    money.className = o.corrupt ? "money bad" : "money";
    money.textContent = gbp.format(o.total ?? 0);

    tr.append(id, item, mods, st, money);
    body.appendChild(tr);
  }
}

function renderBanner(d) {
  const b = el("banner");
  const broken = d.counts.failing > 0 || d.assetsMissing > 0;
  b.className = broken ? "banner bad" : "banner ok";
  b.innerHTML = "";

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = broken ? "!" : "✓";

  const text = document.createElement("span");
  const t = document.createElement("span");
  t.className = "t";
  const sub = document.createElement("span");
  sub.className = "d";

  if (broken) {
    const parts = [];
    if (d.counts.failing) parts.push(`${d.counts.failing} orders failing validation`);
    if (d.assetsMissing) parts.push(`${d.assetsMissing} menu assets unreachable`);
    t.textContent = parts.join(" · ");
    sub.textContent = "Customers are seeing incorrect totals and a broken storefront.";
  } else {
    t.textContent = "All orders validating";
    sub.textContent = "Menu assets present. Nothing outstanding.";
  }

  text.append(t, sub);
  b.append(icon, text);
}

async function refresh() {
  if (!current) return;
  try {
    const res = await fetch(`/api/tenant/${current}`);
    const d = await res.json();
    if (d.error) throw new Error(d.error);

    clearDiag();
    lastGood = Date.now();
    setBeat();

    health[current] = d.counts.failing === 0 && d.assetsMissing === 0;
    renderRail();

    el("tname").textContent = d.name;
    el("tsub").textContent = `${d.counts.total} orders in the last 6 hours`;
    el("pk").textContent = `pk = ${d.partitionKey}`;

    renderBanner(d);

    el("s-total").textContent = d.counts.total;
    el("f-total").textContent = "across all statuses";

    const bad = el("s-bad");
    bad.textContent = d.counts.failing;
    bad.className = d.counts.failing ? "value bad" : "value ok";
    el("f-bad").textContent = d.counts.failing
      ? `${Math.round((d.counts.failing / d.counts.total) * 100)}% of today's orders`
      : "none";

    const assets = el("s-assets");
    assets.textContent = `${d.menu.length - d.assetsMissing}/${d.menu.length}`;
    assets.className = d.assetsMissing ? "value bad" : "value";
    el("f-assets").textContent = d.assetsMissing ? `${d.assetsMissing} missing from S3` : "all present";

    const gross = d.orders.reduce((a, o) => a + (o.corrupt ? 0 : o.total || 0), 0);
    el("s-value").textContent = gbp.format(gross);
    el("f-value").textContent = d.counts.failing ? "excludes failed orders" : "recent orders";

    renderGallery(d.menu);
    renderOrders(d.orders);
  } catch (err) {
    const info = interpret(err.message);
    showDiag(info.title, info.body, info.hint, err.message);
    setBeat();
  }
}

async function boot() {
  try {
    const res = await fetch("/api/tenants");
    const data = await res.json();
    tenants = data.tenants;
    current = tenants[0].slug;
    el("total").textContent = tenants.length.toLocaleString("en-GB");
    renderRail();
    await refresh();
  } catch (err) {
    const info = interpret(err.message);
    showDiag(info.title, info.body, info.hint, err.message);
  }
}

boot();
setInterval(refresh, 4000);
