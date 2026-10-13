import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Valores falsos, só para os testes.
process.env.ML_CLIENT_ID = "1234567890";
process.env.ML_CLIENT_SECRET = "segredo-falso-de-teste";
process.env.SESSION_SECRET = "s".repeat(48);

import login from "../netlify/functions/ml-login.mjs";
import callback from "../netlify/functions/ml-callback.mjs";
import me from "../netlify/functions/ml-me.mjs";
import logout from "../netlify/functions/ml-logout.mjs";
import { selar } from "../netlify/lib/sessao.mjs";

const SITE = "https://exemplo.netlify.app";
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const cookiesDe = (res) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(";")[0].split("=")).map(([k, ...v]) => [k, v.join("=")]));
const cabecalhoCookie = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("; ");

test("login manda para o Mercado Livre com state e redirect_uri certos", async () => {
  const res = await login(new Request(SITE + "/api/ml/login"));
  assert.equal(res.status, 302);
  const destino = new URL(res.headers.get("location"));
  assert.equal(destino.origin, "https://auth.mercadolivre.com.br");
  assert.equal(destino.searchParams.get("client_id"), "1234567890");
  assert.equal(destino.searchParams.get("redirect_uri"), SITE + "/api/ml/callback");
  assert.equal(destino.searchParams.get("response_type"), "code");
  assert.equal(cookiesDe(res).ml_estado, destino.searchParams.get("state"));
});

test("callback recusa state diferente do cookie", async () => {
  const req = new Request(SITE + "/api/ml/callback?code=TG-1&state=falso", { headers: { cookie: "ml_estado=verdadeiro" } });
  const res = await callback(req);
  assert.equal(res.headers.get("location"), "/?erro=estado");
  assert.equal(res.headers.getSetCookie().some((c) => c.startsWith("ml_sessao=")), false);
});

test("callback troca o código, grava cookie criptografado e não expõe o token", async () => {
  let corpoEnviado;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.mercadolibre.com/oauth/token");
    corpoEnviado = new URLSearchParams(String(init.body));
    return new Response(JSON.stringify({ access_token: "APP_USR-aaa", refresh_token: "TG-rrr", expires_in: 21600, user_id: 99 }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/callback?code=TG-codigo&state=abc", { headers: { cookie: "ml_estado=abc" } });
  const res = await callback(req);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/?conectado=1");
  assert.equal(corpoEnviado.get("grant_type"), "authorization_code");
  assert.equal(corpoEnviado.get("code"), "TG-codigo");
  assert.equal(corpoEnviado.get("redirect_uri"), SITE + "/api/ml/callback");
  const cookiesLista = res.headers.getSetCookie();
  assert.equal(cookiesLista.length, 1, "callback de sucesso deve enviar apenas o cookie de sessão");
  assert.equal(cookiesLista[0].startsWith("ml_sessao="), true);
  const cookies = cookiesLista.join("\n");
  assert.match(cookies, /ml_sessao=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(cookies.includes("APP_USR-aaa"), false);
  assert.equal(cookies.includes("TG-rrr"), false);
  assert.equal(res.headers.getSetCookie().filter((c) => c.startsWith("ml_sessao=")).length, 1);
  assert.equal(res.headers.getSetCookie().some((c) => c.startsWith("ml_estado=")), false);
});



test("callback informa invalid_client sem expor segredos", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_client", message: "invalid client" }), { status: 400 });
  const req = new Request(SITE + "/api/ml/callback?code=TG-codigo&state=abc", { headers: { cookie: "ml_estado=abc" } });
  const res = await callback(req);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/?erro=troca&codigo=invalid_client");
  assert.equal(res.headers.getSetCookie().some((c) => c.startsWith("ml_sessao=")), false);
});
test("me devolve a conta conectada sem tokens", async () => {
  const sessao = selar({ access_token: "APP_USR-aaa", refresh_token: "TG-rrr", user_id: 99, expires_at: Date.now() + 5 * 3600 * 1000 });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.mercadolibre.com/users/me");
    assert.equal(init.headers.authorization, "Bearer APP_USR-aaa");
    return new Response(JSON.stringify({ id: 99, nickname: "LOJA_TESTE", site_id: "MLB" }), { status: 200 });
  };
  const res = await me(new Request(SITE + "/api/ml/me", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } }));
  const texto = await res.text();
  assert.deepEqual(JSON.parse(texto), { connected: true, nickname: "LOJA_TESTE", user_id: 99, site_id: "MLB", tags: [], user_product_seller: false });
  assert.equal(texto.includes("APP_USR"), false);
  assert.equal(res.headers.getSetCookie().length, 0);
});



test("me detecta seller migrado para User Products", async () => {
  const sessao = selar({ access_token: "APP_USR-up", refresh_token: "TG-up", user_id: 99, expires_at: Date.now() + 5 * 3600 * 1000 });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 99, nickname: "LOJA_UP", site_id: "MLB", tags: ["normal", "user_product_seller"] }), { status: 200 });
  const res = await me(new Request(SITE + "/api/ml/me", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } }));
  const body = await res.json();
  assert.equal(body.connected, true);
  assert.equal(body.user_product_seller, true);
  assert.ok(body.tags.includes("user_product_seller"));
});

test("me renova o token vencido e regrava o cookie", async () => {
  const sessao = selar({ access_token: "velho", refresh_token: "TG-velho", user_id: 99, expires_at: Date.now() - 1000 });
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push(String(url));
    if (String(url).endsWith("/oauth/token")) {
      const corpo = new URLSearchParams(String(init.body));
      assert.equal(corpo.get("grant_type"), "refresh_token");
      assert.equal(corpo.get("refresh_token"), "TG-velho");
      return new Response(JSON.stringify({ access_token: "novo", refresh_token: "TG-novo", expires_in: 21600, user_id: 99 }), { status: 200 });
    }
    assert.equal(init.headers.authorization, "Bearer novo");
    return new Response(JSON.stringify({ id: 99, nickname: "LOJA_TESTE", site_id: "MLB" }), { status: 200 });
  };
  const res = await me(new Request(SITE + "/api/ml/me", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } }));
  assert.equal((await res.json()).connected, true);
  assert.deepEqual(chamadas.map((u) => new URL(u).pathname), ["/oauth/token", "/users/me"]);
  const novo = cookiesDe(res).ml_sessao;
  assert.ok(novo && novo !== sessao);
});

test("me trata cookie adulterado como sem conta", async () => {
  const sessao = selar({ access_token: "a", refresh_token: "b", user_id: 1, expires_at: Date.now() + 3600e3 * 5 });
  const adulterado = sessao.slice(0, -4) + (sessao.endsWith("AAAA") ? "BBBB" : "AAAA");
  globalThis.fetch = async () => { throw new Error("não devia chamar o ML"); };
  const res = await me(new Request(SITE + "/api/ml/me", { headers: { cookie: cabecalhoCookie({ ml_sessao: adulterado }) } }));
  assert.deepEqual(await res.json(), { connected: false });
});

test("logout só aceita POST e apaga o cookie", async () => {
  assert.equal((await logout(new Request(SITE + "/api/ml/logout"))).status, 405);
  const res = await logout(new Request(SITE + "/api/ml/logout", { method: "POST" }));
  assert.match(res.headers.getSetCookie().join(), /ml_sessao=; .*Max-Age=0/);
});

import publish from "../netlify/functions/ml-publish.mjs";
import category from "../netlify/functions/ml-category.mjs";
import validate from "../netlify/functions/ml-validate.mjs";
import items from "../netlify/functions/ml-items.mjs";
import itemUpdate from "../netlify/functions/ml-item-update.mjs";
import ads from "../netlify/functions/ml-ads.mjs";

function cookieSessaoTeste() {
  return selar({ access_token: "APP_USR-teste", refresh_token: "TG-teste", user_id: 99, expires_at: Date.now() + 5 * 3600 * 1000 });
}

test("validate envia o item ao endpoint /items/validate", async () => {
  const sessao = cookieSessaoTeste();
  let recebido;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.mercadolibre.com/items/validate");
    assert.equal(init.headers.get ? init.headers.get("authorization") : init.headers.authorization, "Bearer APP_USR-teste");
    recebido = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  };
  const req = new Request(SITE + "/api/ml/validate", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item: { title: "Teste", category_id: "MLB1" } }),
  });
  const res = await validate(req);
  assert.equal(res.status, 200);
  assert.deepEqual(recebido, { title: "Teste", category_id: "MLB1" });
  assert.equal((await res.json()).valid, true);
});

test("publish cria item e depois publica a descrição", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: String(url), method: init.method, body: init.body });
    if (String(url).endsWith("/items")) {
      return new Response(JSON.stringify({ id: "MLB123", title: "Produto", permalink: "https://produto", status: "active" }), { status: 201 });
    }
    assert.equal(String(url), "https://api.mercadolibre.com/items/MLB123/description");
    return new Response(JSON.stringify({ plain_text: "Descrição" }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/publish", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item: { title: "Produto", category_id: "MLB1", price: 100, currency_id: "BRL", buying_mode: "buy_it_now", listing_type_id: "gold_special" }, description: "Descrição" }),
  });
  const res = await publish(req);
  assert.equal(res.status, 201);
  const j = await res.json();
  assert.equal(j.published, true);
  assert.equal(j.id, "MLB123");
  assert.equal(j.description_ok, true);
  assert.equal(chamadas.length, 2);
});



test("publish cria Clássico e Premium no mesmo User Product", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    chamadas.push({ url: u, method: init.method, body: init.body });
    if (u.endsWith("/user-products/MLBU999/items")) {
      const body = JSON.parse(init.body);
      assert.equal(body.listing_type_id, "gold_pro");
      return new Response(JSON.stringify({ id: "MLB101", user_product_id: "MLBU999", listing_type_id: "gold_pro", price: 100, title: "Produto", permalink: "https://premium", status: "active" }), { status: 201 });
    }
    if (u.endsWith("/items")) {
      return new Response(JSON.stringify({ id: "MLB100", user_product_id: "MLBU999", listing_type_id: "gold_special", price: 100, title: "Produto", permalink: "https://classico", status: "active" }), { status: 201 });
    }
    if (u.endsWith("/items/MLB100/description") || u.endsWith("/items/MLB101/description")) {
      return new Response(JSON.stringify({ plain_text: "Descrição" }), { status: 200 });
    }
    throw new Error("URL inesperada " + u);
  };
  const req = new Request(SITE + "/api/ml/publish", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({
      item: { family_name: "Produto", category_id: "MLB1", price: 100, currency_id: "BRL", buying_mode: "buy_it_now", listing_type_id: "gold_special" },
      listing_conditions: [
        { listing_type_id: "gold_special", price: 100 },
        { listing_type_id: "gold_pro", price: 100 },
      ],
      description: "Descrição",
    }),
  });
  const res = await publish(req);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.conditions.length, 2);
  assert.equal(body.conditions[0].listing_type_id, "gold_special");
  assert.equal(body.conditions[1].listing_type_id, "gold_pro");
  assert.equal(body.conditions[1].id, "MLB101");
});

test("Meus anúncios usa /items/bulk e filtra Premium localmente", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/users/99/items/search")) {
      assert.equal(u.includes("listing_type_id"), false);
      const q = new URL(u);
      assert.equal(q.searchParams.get("orders"), "last_updated_desc");
      return new Response(JSON.stringify({ results: ["MLB1", "MLB2"], paging: { total: 2, offset: 0, limit: 100 } }), { status: 200 });
    }
    if (u.includes("/items/bulk?ids=MLB1,MLB2")) {
      return new Response(JSON.stringify([
        { code: 200, body: { id: "MLB1", listing_type_id: "gold_special", title: "Clássico" } },
        { code: 200, body: { id: "MLB2", listing_type_id: "gold_pro", title: "Premium" } },
      ]), { status: 200 });
    }
    throw new Error("URL inesperada " + u);
  };
  const req = new Request(SITE + "/api/ml/items?listing_type_id=gold_pro", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } });
  const res = await items(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, "MLB2");
});

test("Meus anúncios salva prazo de disponibilidade quando a categoria permite", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    chamadas.push({ u, method: init.method || "GET", body: init.body });
    if (u.endsWith("/items/MLB123")) {
      if ((init.method || "GET") === "PUT") {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.sale_terms, [{ id: "MANUFACTURING_TIME", value_name: "12 dias" }]);
        return new Response(JSON.stringify({ id: "MLB123", sale_terms: body.sale_terms }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "MLB123", category_id: "MLB223534", shipping: { logistic_type: "cross_docking" } }), { status: 200 });
    }
    if (u.endsWith("/categories/MLB223534/sale_terms")) {
      return new Response(JSON.stringify([{ id: "MANUFACTURING_TIME", value_type: "number_unit", allowed_units: [{ id: "dias", name: "dias" }] }]), { status: 200 });
    }
    throw new Error("URL inesperada " + u);
  };
  const req = new Request(SITE + "/api/ml/item-update", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item_id: "MLB123", manufacturing_time: 12 }),
  });
  const res = await itemUpdate(req);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).updated, true);
  assert.equal(chamadas.some((x) => x.u.endsWith("/categories/MLB223534/sale_terms")), true);
});

test("Meus anúncios remove prazo de disponibilidade", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.mercadolibre.com/items/MLB123");
    assert.equal(init.method, "PUT");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.sale_terms, [{ id: "MANUFACTURING_TIME", value_id: null, value_name: null }]);
    return new Response(JSON.stringify({ id: "MLB123" }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/item-update", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item_id: "MLB123", manufacturing_time: null }),
  });
  const res = await itemUpdate(req);
  assert.equal(res.status, 200);
});

test("Product Ads explica quando o produto não está habilitado", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url) => {
    assert.match(String(url), /advertising\/advertisers\?product_id=PADS/);
    return new Response(JSON.stringify({ message: "No permissions found for user_id", error: "not_found", status: 404 }), { status: 404, headers: { "content-type": "application/json" } });
  };
  const req = new Request(SITE + "/api/ml/ads", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } });
  const res = await ads(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.equal(body.reason, "product_not_enabled");
  assert.match(body.message, /Meu perfil > Publicidade/);
});
test("category resume atributos, variações e tipos de anúncio", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/categories/MLB223534")) return new Response(JSON.stringify({ id: "MLB223534", name: "Perneiras", settings: { max_variations_allowed: 100, max_pictures_per_item: 12, max_pictures_per_item_var: 10 } }), { status: 200 });
    if (u.endsWith("/categories/MLB223534/attributes")) return new Response(JSON.stringify([
      { id: "COLOR", name: "Cor", tags: { allow_variations: true }, value_type: "list", values: [{ id: "1", name: "Preto" }] },
      { id: "GTIN", name: "GTIN", tags: { conditional_required: true, variation_attribute: true }, value_type: "string", values: [] },
      { id: "BRAND", name: "Marca", tags: { required: true }, value_type: "string", values: [] },
    ]), { status: 200 });
    if (u.includes("available_listing_types")) return new Response(JSON.stringify({ available: [{ id: "gold_special", name: "Clássico" }] }), { status: 200 });
    throw new Error("URL inesperada " + u);
  };
  const req = new Request(SITE + "/api/ml/category?category_id=MLB223534", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } });
  const res = await category(req);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.category.name, "Perneiras");
  assert.equal(j.variation_attributes[0].id, "COLOR");
  assert.equal(j.required_attributes.some((a) => a.id === "BRAND"), true);
  assert.equal(j.listing_types[0].id, "gold_special");
});

import { normalizarItemPayload } from "../netlify/lib/ml.mjs";

test("normaliza motivo de GTIN para value_id oficial", () => {
  const item = normalizarItemPayload({
    title: "Produto",
    attributes: [
      { id: "SELLER_SKU", value_name: "SKU-1" },
      { id: "EMPTY_GTIN_REASON", value_name: "Artesanal" },
    ],
  });
  assert.deepEqual(item.attributes.find((a) => a.id === "EMPTY_GTIN_REASON"), { id: "EMPTY_GTIN_REASON", value_id: "17055158" });
});

test("remove motivo de GTIN quando um GTIN foi informado", () => {
  const item = normalizarItemPayload({
    title: "Produto",
    attributes: [
      { id: "GTIN", value_name: "7891234567895" },
      { id: "EMPTY_GTIN_REASON", value_id: "17055158" },
    ],
  });
  assert.equal(item.attributes.some((a) => a.id === "EMPTY_GTIN_REASON"), false);
  assert.equal(item.attributes.some((a) => a.id === "GTIN"), true);
});

test("User Products remove title e rejeita variations no mesmo item", () => {
  const item = normalizarItemPayload({ family_name: "Família", title: "Não enviar", attributes: [] });
  assert.equal(item.family_name, "Família");
  assert.equal("title" in item, false);
  assert.throws(() => normalizarItemPayload({ family_name: "Família", variations: [{ id: 1 }] }), /User Products/);
});

test("validate trata warnings de frete como validação aprovada", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.mercadolibre.com/items/validate");
    const recebido = JSON.parse(init.body);
    assert.equal(recebido.shipping?.mode, undefined);
    return new Response(JSON.stringify({
      message: "Validation error",
      error: "validation_error",
      status: 400,
      cause: [
        { department: "shipping", cause_id: 4053, type: "warning", code: "shipping.me1_not_available", message: "User has not mode me1" },
        { department: "shipping", cause_id: 4029, type: "warning", code: "shipping.me2_adoption_mandatory", message: "Mandatory free shipping added" },
      ],
    }), { status: 400, headers: { "content-type": "application/json" } });
  };
  const req = new Request(SITE + "/api/ml/validate", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item: { title: "Produto", category_id: "MLB1", shipping: { mode: "me1", free_shipping: false } } }),
  });
  const res = await validate(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.valid, true);
  assert.equal(body.warnings.length, 2);
  assert.match(body.warnings[0], /não possui Mercado Envios 1/i);
  assert.match(body.warnings[1], /frete grátis como obrigatório/i);
});

test("validate continua bloqueando quando há error junto com warning", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: "Validation error",
    error: "validation_error",
    status: 400,
    cause: [
      { department: "shipping", cause_id: 4029, type: "warning", code: "shipping.me2_adoption_mandatory", message: "Mandatory free shipping added" },
      { department: "structured-data", cause_id: 3704, type: "error", code: "item.attribute.missing_catalog_required", message: "The BRAND field is mandatory and was not added" },
    ],
  }), { status: 400, headers: { "content-type": "application/json" } });
  const req = new Request(SITE + "/api/ml/validate", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item: { title: "Produto", category_id: "MLB1" } }),
  });
  const res = await validate(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.erro, /BRAND/);
  assert.doesNotMatch(body.erro, /Mandatory free shipping added/i);
});



test("preserva atributo customizado de User Products", () => {
  const item = normalizarItemPayload({
    family_name: "Perneira de Neoprene",
    attributes: [
      { id: "BRAND", value_name: "Trem Bão" },
      { name: "Tamanho da perneira", value_name: "PP com Altura P" },
    ],
  });
  assert.equal(item.attributes.some((a) => a.id === "BRAND"), true);
  assert.deepEqual(item.attributes.find((a) => a.name === "Tamanho da perneira"), { name: "Tamanho da perneira", value_name: "PP com Altura P" });
});
test("normalizador não força modo de envio ME1 ou ME2", () => {
  const item = normalizarItemPayload({
    title: "Produto",
    shipping: { mode: "me1", local_pick_up: false, free_shipping: false },
  });
  assert.deepEqual(item.shipping, { local_pick_up: false, free_shipping: false });
});

import promotions from "../netlify/functions/ml-promotions.mjs";
import catalog from "../netlify/functions/ml-catalog.mjs";
import orders from "../netlify/functions/ml-orders.mjs";
import messages from "../netlify/functions/ml-messages.mjs";
import billing from "../netlify/functions/ml-billing.mjs";
import categorySuggest from "../netlify/functions/ml-category-suggest.mjs";
import questions from "../netlify/functions/ml-questions.mjs";
import shipment from "../netlify/functions/ml-shipment.mjs";

test("Promoções cria campanha SELLER_CAMPAIGN flexível", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2");
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    assert.equal(body.promotion_type, "SELLER_CAMPAIGN");
    assert.equal(body.sub_type, "FLEXIBLE_PERCENTAGE");
    assert.equal(body.name, "Semana Trem Bão");
    return new Response(JSON.stringify({ id: "C-MLB1", status: "pending", ...body }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/promotions", { method: "POST", headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" }, body: JSON.stringify({ action: "create_campaign", name: "Semana Trem Bão", start_date: "2026-10-10", finish_date: "2026-10-17" }) });
  const res = await promotions(req); assert.equal(res.status, 200); const j = await res.json(); assert.equal(j.result.id, "C-MLB1");
});

test("Promoções adiciona item à campanha do vendedor", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.mercadolibre.com/seller-promotions/items/MLB123?app_version=v2");
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body); assert.equal(body.promotion_id, "C-MLB1"); assert.equal(body.deal_price, 79.9);
    return new Response(JSON.stringify({ price: 79.9, original_price: 89.9 }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/promotions", { method: "POST", headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" }, body: JSON.stringify({ action: "add_campaign_item", item_id: "MLB123", promotion_id: "C-MLB1", deal_price: 79.9 }) });
  const res = await promotions(req); assert.equal(res.status, 200); assert.equal((await res.json()).ok, true);
});

test("Product Ads cria campanha API v2 com ROAS", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas=[];
  globalThis.fetch = async (url, init = {}) => {
    const u=String(url); chamadas.push(u);
    if(u.endsWith("/advertising/advertisers?product_id=PADS")) return new Response(JSON.stringify({ advertisers:[{advertiser_id:77,site_id:"MLB",account_name:"Trem Bão"}] }),{status:200});
    assert.equal(u,"https://api.mercadolibre.com/marketplace/advertising/MLB/advertisers/77/product_ads/campaigns");
    assert.equal(init.headers.get("api-version"),"2"); const body=JSON.parse(init.body); assert.equal(body.roas_target,10); assert.equal(body.strategy,"increase");
    return new Response(JSON.stringify({id:555,...body}),{status:200});
  };
  const req=new Request(SITE+"/api/ml/ads",{method:"POST",headers:{cookie:cabecalhoCookie({ml_sessao:sessao}),"content-type":"application/json"},body:JSON.stringify({action:"create_campaign",name:"Campanha",budget:30,roas_target:10,strategy:"increase",status:"paused"})});
  const res=await ads(req); assert.equal(res.status,200); assert.equal((await res.json()).result.id,555); assert.equal(chamadas.length,2);
});

test("Product Ads localiza Ad Group e adiciona produto à campanha", async () => {
  const sessao=cookieSessaoTeste();
  globalThis.fetch=async(url,init={})=>{const u=String(url);
    if(u.endsWith("/advertising/advertisers?product_id=PADS")) return new Response(JSON.stringify({advertisers:[{advertiser_id:77,site_id:"MLB"}]}),{status:200});
    if(u.includes("/ad_groups/search?filters[item_ids]=")) return new Response(JSON.stringify({results:[{id:900,ad_group_external_id:"MLB123",title:"Produto"}]}),{status:200});
    assert.equal(u,"https://api.mercadolibre.com/marketplace/advertising/MLB/advertisers/77/product_ads/ad_groups"); const body=JSON.parse(init.body); assert.deepEqual(body.ad_groups,[900]); assert.equal(body.campaign_id,555); return new Response(JSON.stringify({status:"active",campaign_id:555}),{status:200});
  };
  const req=new Request(SITE+"/api/ml/ads",{method:"POST",headers:{cookie:cabecalhoCookie({ml_sessao:sessao}),"content-type":"application/json"},body:JSON.stringify({action:"assign_items",campaign_id:555,item_ids:["MLB123"]})});
  const res=await ads(req); assert.equal(res.status,200); assert.equal((await res.json()).ad_groups[0].ad_group_id,900);
});

test("Catálogo consulta elegibilidade e faz opt-in", async () => {
  const sessao=cookieSessaoTeste(); let posted;
  globalThis.fetch=async(url,init={})=>{const u=String(url);
    if(u.endsWith("/items/MLB123")) return new Response(JSON.stringify({id:"MLB123",title:"Produto",catalog_product_id:"MLB-CAT1",variations:[]}),{status:200});
    if(u.endsWith("/items/MLB123/catalog_listing_eligibility")) return new Response(JSON.stringify({id:"MLB123",status:"READY_FOR_OPTIN",buy_box_eligible:true,variations:[]}),{status:200});
    if(u.endsWith("/products/MLB-CAT1")) return new Response(JSON.stringify({id:"MLB-CAT1",name:"Produto catálogo",status:"active",children_ids:[]}),{status:200});
    if(u.endsWith("/items/catalog_listings")){posted=JSON.parse(init.body);return new Response(JSON.stringify({id:"MLB999",catalog_listing:true}),{status:201});}
    throw new Error("URL inesperada "+u);
  };
  const get=await catalog(new Request(SITE+"/api/ml/catalog?item_id=MLB123",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}})); assert.equal(get.status,200); assert.equal((await get.json()).eligibility.status,"READY_FOR_OPTIN");
  const post=await catalog(new Request(SITE+"/api/ml/catalog",{method:"POST",headers:{cookie:cabecalhoCookie({ml_sessao:sessao}),"content-type":"application/json"},body:JSON.stringify({item_id:"MLB123"})})); assert.equal(post.status,200); assert.deepEqual(posted,{item_id:"MLB123",catalog_product_id:"MLB-CAT1"});
});


test("Catálogo em lote processa o produto principal sem abrir cada variação", async () => {
  const sessao=cookieSessaoTeste(); let posts=0;
  globalThis.fetch=async(url,init={})=>{const u=String(url);
    if(u.endsWith("/items/MLB321")) return new Response(JSON.stringify({id:"MLB321",title:"Produto P",user_product_id:"MLBU1",catalog_product_id:"MLB-CAT321",variations:[]}),{status:200});
    if(u.endsWith("/items/MLB321/catalog_listing_eligibility")) return new Response(JSON.stringify({id:"MLB321",status:"READY_FOR_OPTIN",buy_box_eligible:true,variations:[]}),{status:200});
    if(u.endsWith("/products/MLB-CAT321")) return new Response(JSON.stringify({id:"MLB-CAT321",name:"Produto catálogo P",status:"active",children_ids:[]}),{status:200});
    if(u.endsWith("/items/catalog_listings")){posts++;const b=JSON.parse(init.body);assert.deepEqual(b,{item_id:"MLB321",catalog_product_id:"MLB-CAT321"});return new Response(JSON.stringify({id:"MLB-CAT-ITEM-1",catalog_listing:true}),{status:201});}
    throw new Error("URL inesperada "+u);
  };
  const req=new Request(SITE+"/api/ml/catalog",{method:"POST",headers:{cookie:cabecalhoCookie({ml_sessao:sessao}),"content-type":"application/json"},body:JSON.stringify({action:"bulk_optin",targets:[{item_id:"MLB321",catalog_product_id:"MLB-CAT321"}]})});
  const res=await catalog(req);assert.equal(res.status,200);const body=await res.json();assert.equal(body.ok,true);assert.equal(body.results[0].ok,true);assert.equal(posts,1);
});

test("Meus anúncios transforma produto em catálogo por um único botão principal", () => {
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/group-catalog-button/);
  assert.match(html,/>Transformar em catálogo<\/button>/);
  assert.match(html,/transformProductCatalogDirect/);
  assert.doesNotMatch(html,/class="item-catalog"/);
});

test("Pedidos usa /orders/search pelo seller conectado", async()=>{
  const sessao=cookieSessaoTeste(); globalThis.fetch=async(url)=>{const u=new URL(String(url));assert.equal(u.pathname,"/orders/search");assert.equal(u.searchParams.get("seller"),"99");return new Response(JSON.stringify({paging:{total:1},results:[{id:1,status:"paid"}]}),{status:200})};
  const res=await orders(new Request(SITE+"/api/ml/orders",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}}));assert.equal(res.status,200);assert.equal((await res.json()).orders[0].status,"paid");
});

test("Mensagens consulta pack sem marcar como lido", async()=>{
  const sessao=cookieSessaoTeste(); globalThis.fetch=async(url)=>{const u=String(url);assert.match(u,/messages\/packs\/200\/sellers\/99\?mark_as_read=false&tag=post_sale/);return new Response(JSON.stringify({messages:[{id:"m1",text:"Oi"}]}),{status:200})};
  const res=await messages(new Request(SITE+"/api/ml/messages?pack_id=200",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}}));assert.equal(res.status,200);assert.equal((await res.json()).messages.messages.length,1);
});

test("Faturamento lista períodos mensais do grupo ML", async()=>{
  const sessao=cookieSessaoTeste();globalThis.fetch=async(url)=>{const u=new URL(String(url));assert.equal(u.pathname,"/billing/integration/monthly/periods");assert.equal(u.searchParams.get("group"),"ML");assert.equal(u.searchParams.get("document_type"),"BILL");return new Response(JSON.stringify({results:[{key:"2026-10-01",amount:10}],total:1,offset:0,limit:6}),{status:200})};
  const res=await billing(new Request(SITE+"/api/ml/billing",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}}));assert.equal(res.status,200);assert.equal((await res.json()).periods[0].key,"2026-10-01");
});

test("Sugestão de categoria usa domain discovery", async()=>{
  const sessao=cookieSessaoTeste();globalThis.fetch=async(url)=>{assert.match(String(url),/sites\/MLB\/domain_discovery\/search/);return new Response(JSON.stringify([{category_id:"MLB223534",category_name:"Perneiras"}]),{status:200})};
  const res=await categorySuggest(new Request(SITE+"/api/ml/category-suggest?q=perneira",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}}));assert.equal(res.status,200);assert.equal((await res.json()).results[0].category_id,"MLB223534");
});


test("Perguntas pré-venda lista não respondidas e responde", async()=>{
  const sessao=cookieSessaoTeste(); let stage=0;
  globalThis.fetch=async(url,init={})=>{const u=new URL(String(url));
    if(u.pathname==="/questions/search"){assert.equal(u.searchParams.get("seller_id"),"99");assert.equal(u.searchParams.get("api_version"),"4");assert.equal(u.searchParams.get("status"),"UNANSWERED");return new Response(JSON.stringify({total:1,limit:30,questions:[{id:123,item_id:"MLB1",status:"UNANSWERED",text:"Tem pronta entrega?"}]}),{status:200});}
    if(u.pathname==="/answers"){stage++;assert.equal(init.method,"POST");const b=JSON.parse(init.body);assert.equal(b.question_id,123);assert.equal(b.text,"Sim, temos.");return new Response(JSON.stringify({id:123,status:"ANSWERED"}),{status:200});}
    throw new Error("URL inesperada "+u);
  };
  const get=await questions(new Request(SITE+"/api/ml/questions?status=UNANSWERED",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}}));assert.equal(get.status,200);assert.equal((await get.json()).questions[0].id,123);
  const post=await questions(new Request(SITE+"/api/ml/questions",{method:"POST",headers:{cookie:cabecalhoCookie({ml_sessao:sessao}),"content-type":"application/json"},body:JSON.stringify({question_id:123,text:"Sim, temos."})}));assert.equal(post.status,200);assert.equal(stage,1);
});

test("Envio usa x-format-new e consulta SLA", async()=>{
  const sessao=cookieSessaoTeste();
  globalThis.fetch=async(url,init={})=>{const u=String(url);
    if(u.endsWith("/shipments/555")){const h=new Headers(init.headers||{});assert.equal(h.get("x-format-new"),"true");return new Response(JSON.stringify({id:555,status:"ready_to_ship",logistic_type:"drop_off",tracking_number:"ABC"}),{status:200});}
    if(u.endsWith("/shipments/555/sla"))return new Response(JSON.stringify({status:"on_time",expected_date:"2026-10-07T12:00:00-03:00"}),{status:200});
    throw new Error("URL inesperada "+u);
  };
  const res=await shipment(new Request(SITE+"/api/ml/shipment?shipment_id=555",{headers:{cookie:cabecalhoCookie({ml_sessao:sessao})}}));assert.equal(res.status,200);const j=await res.json();assert.equal(j.shipment.status,"ready_to_ship");assert.equal(j.sla.status,"on_time");
});

test("Meus anúncios atualiza a seleção e ordem das imagens", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.mercadolibre.com/items/MLB123");
    assert.equal(init.method, "PUT");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.pictures, [{ id: "IMG-B" }, { id: "IMG-A" }, { id: "IMG-NOVA" }]);
    return new Response(JSON.stringify({ id: "MLB123", pictures: body.pictures }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/item-update", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item_id: "MLB123", pictures: ["IMG-B", "IMG-A", "IMG-NOVA"] }),
  });
  const res = await itemUpdate(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.updated, true);
});

test("Meus anúncios não permite salvar um anúncio sem imagens", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async () => { throw new Error("não deveria chamar a API"); };
  const req = new Request(SITE + "/api/ml/item-update", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ item_id: "MLB123", pictures: [] }),
  });
  const res = await itemUpdate(req);
  assert.equal(res.status, 400);
  assert.match((await res.json()).erro, /pelo menos uma imagem/i);
});

test("Meus anúncios consulta um recém-publicado diretamente por item_id", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.mercadolibre.com/items/MLB999");
    return new Response(JSON.stringify({ id: "MLB999", title: "Novo anúncio", status: "active", listing_type_id: "gold_special" }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/items?item_id=MLB999", { headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }) } });
  const res = await items(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.item.id, "MLB999");
});


test("Promoções em lote aplica preços diferentes em vários itens da campanha", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ price: JSON.parse(init.body).deal_price }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/promotions", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({
      action: "bulk_campaign_items",
      promotion_id: "C-MLB1",
      items: [
        { item_id: "MLB101", deal_price: 79.9, product_name: "Perneira", listing_type: "classic" },
        { item_id: "MLB102", deal_price: 84.9, product_name: "Perneira", listing_type: "premium" },
        { item_id: "MLB201", deal_price: 129.9, product_name: "Manta", listing_type: "classic" },
      ],
    }),
  });
  const res = await promotions(req);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.processed, 3);
  assert.equal(j.success, 3);
  assert.equal(j.failed, 0);
  assert.deepEqual(chamadas.map((x) => x.body.deal_price).sort((a,b)=>a-b), [79.9, 84.9, 129.9]);
  assert.ok(chamadas.every((x) => x.body.promotion_id === "C-MLB1" && x.method === "POST"));
});

test("Promoções em lote tenta PUT quando item já existe na campanha", async () => {
  const sessao = cookieSessaoTeste();
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    n++;
    if (n === 1) return new Response(JSON.stringify({ message: "already in promotion" }), { status: 400 });
    assert.equal(init.method, "PUT");
    return new Response(JSON.stringify({ price: 75 }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/promotions", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ action: "bulk_campaign_items", promotion_id: "C-MLB1", items: [{ item_id: "MLB777", deal_price: 75, product_name: "Produto" }] }),
  });
  const res = await promotions(req);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.success, 1);
  assert.equal(j.results[0].updated, true);
  assert.equal(n, 2);
});

import optimization from "../netlify/functions/ml-optimization.mjs";

test("Central de otimização consulta qualidade, competição de catálogo e moderação", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    chamadas.push(u);
    if (u.endsWith("/user-product/MLBU123/performance")) {
      return new Response(JSON.stringify({
        entity_type: "USER_PRODUCT",
        entity_id: "MLBU123",
        score: 72,
        level_wording: "Satisfatória",
        buckets: [{ key: "CHARACTERISTICS", status: "PENDING", title: "Dados do produto", mode: "OPPORTUNITY" }],
      }), { status: 200 });
    }
    if (u.endsWith("/items/MLB123/price_to_win?version=v2")) {
      return new Response(JSON.stringify({ status: "competing", current_price: 100, price_to_win: 95, currency_id: "BRL", reason: "price", boosts: [{ id: "free_shipping", status: "opportunity", description: "Frete grátis" }] }), { status: 200 });
    }
    if (u.endsWith("/moderations/last_moderation/MLB123-ITM")) {
      return new Response(JSON.stringify([{ id: "MOD1", name: "POOR_QUALITY_THUMBNAIL", wordings: [{ type: "REASON", value: "Imagem com baixa qualidade" }, { type: "REMEDY", value: "Troque a foto principal" }] }]), { status: 200 });
    }
    throw new Error("URL inesperada " + u);
  };
  const req = new Request(SITE + "/api/ml/optimization", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ action: "analyze", targets: [{ item_id: "MLB123", user_product_id: "MLBU123", catalog_listing: true, needs_moderation: true }] }),
  });
  const res = await optimization(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.analyzed, 1);
  assert.equal(body.results[0].performance.score, 72);
  assert.equal(body.results[0].competition.price_to_win, 95);
  assert.equal(body.results[0].moderation.remedy, "Troque a foto principal");
  assert.equal(body.results[0].performance.actions[0].title, "Dados do produto");
  assert.equal(chamadas.length, 3);
});

test("Central de otimização não consulta competição para item fora do catálogo", async () => {
  const sessao = cookieSessaoTeste();
  const chamadas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    chamadas.push(u);
    assert.equal(u, "https://api.mercadolibre.com/item/MLB321/performance");
    return new Response(JSON.stringify({ entity_type: "ITEM", entity_id: "MLB321", score: 95, level_wording: "Profissional", buckets: [] }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/optimization", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ targets: [{ item_id: "MLB321", catalog_listing: false, status: "active" }] }),
  });
  const res = await optimization(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results[0].performance.score, 95);
  assert.equal(body.results[0].competition, null);
  assert.equal(chamadas.length, 1);
});

import identifiersBulk from "../netlify/functions/ml-identifiers-bulk.mjs";
import { gtinValido, normalizarSku } from "../netlify/lib/identifiers.mjs";

test("normalização do SKU em lote mantém padrão seguro", () => {
  assert.equal(normalizarSku("cinto-country-marrom-95"), "CINTO-COUNTRY-MARROM-95");
  assert.throws(() => normalizarSku("sku com espaço"), /somente letras/i);
});

test("validação de EAN/GTIN reconhece dígito verificador", () => {
  assert.equal(gtinValido("7891234567895"), true);
  assert.equal(gtinValido("7891234567890"), false);
});

test("SKU/EAN em lote atualiza item simples com SELLER_SKU e GTIN", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.mercadolibre.com/items/MLB123");
    assert.equal(init.method, "PUT");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.attributes, [
      { id: "SELLER_SKU", value_name: "CINTO-COUNTRY-MARROM-95" },
      { id: "GTIN", value_name: "7891234567895" },
      { id: "EMPTY_GTIN_REASON", value_id: null, value_name: null },
    ]);
    return new Response(JSON.stringify({ id: "MLB123" }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/identifiers-bulk", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ operations: [{ row_id: "r1", sku: "CINTO-COUNTRY-MARROM-95", gtin: "7891234567895", targets: [{ item_id: "MLB123" }] }] }),
  });
  const res = await identifiersBulk(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.updated, true);
  assert.equal(body.ok, 1);
  assert.equal(body.failed, 0);
});

test("SKU/EAN em lote altera somente a variação alvo e preserva as demais", async () => {
  const sessao = cookieSessaoTeste();
  let putBody;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    assert.equal(u, "https://api.mercadolibre.com/items/MLB456");
    if ((init.method || "GET") === "GET") {
      return new Response(JSON.stringify({ id: "MLB456", variations: [{ id: 111 }, { id: 222 }] }), { status: 200 });
    }
    putBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "MLB456" }), { status: 200 });
  };
  const req = new Request(SITE + "/api/ml/identifiers-bulk", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ operations: [{ row_id: "r2", sku: "PERNEIRA-COUNTRY-PRETO-M", gtin: "7891234567895", targets: [{ item_id: "MLB456", variation_id: 222 }] }] }),
  });
  const res = await identifiersBulk(req);
  assert.equal(res.status, 200);
  assert.deepEqual(putBody.variations[0], { id: 111 });
  assert.equal(putBody.variations[1].id, 222);
  assert.equal(putBody.variations[1].attributes[0].value_name, "PERNEIRA-COUNTRY-PRETO-M");
});

test("SKU/EAN em lote continua processando quando um anúncio falha", async () => {
  const sessao = cookieSessaoTeste();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/items/MLB901")) return new Response(JSON.stringify({ message: "bloqueado" }), { status: 400, headers: { "content-type": "application/json" } });
    if (u.endsWith("/items/MLB902")) return new Response(JSON.stringify({ id: "MLB902" }), { status: 200 });
    throw new Error("URL inesperada " + u);
  };
  const req = new Request(SITE + "/api/ml/identifiers-bulk", {
    method: "POST",
    headers: { cookie: cabecalhoCookie({ ml_sessao: sessao }), "content-type": "application/json" },
    body: JSON.stringify({ operations: [
      { row_id: "a", sku: "PRODUTO-PRETO-P", targets: [{ item_id: "MLB901" }] },
      { row_id: "b", sku: "PRODUTO-PRETO-M", targets: [{ item_id: "MLB902" }] },
    ] }),
  });
  const res = await identifiersBulk(req);
  const body = await res.json();
  assert.equal(body.ok, 1);
  assert.equal(body.failed, 1);
  assert.equal(body.results.some((r) => r.item_id === "MLB902" && r.ok), true);
});

test("interface Cardoso Coimbra usa grade simples PP P M G GG e ferramenta de SKU/EAN em lote", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /values:\['PP','P','M','G','GG'\]/);
  assert.equal(html.includes("PP com Altura P"), false);
  assert.match(html, /SKU \/ EAN em lote/);
  assert.match(html, /nome do produto \+ cor \+ tamanho/);
  assert.match(html, /SELARIA CARDOSO COIMBRA/);
});

test("interface Cardoso Coimbra inclui calculadora de preço com custos imposto e margem líquida", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-view="calculator"/);
  assert.match(html, /id="calc-cost"/);
  assert.match(html, /id="calc-packaging"/);
  assert.match(html, /id="calc-fixed"/);
  assert.match(html, /id="calc-tax"/);
  assert.match(html, /id="calc-margin"/);
  assert.match(html, /base\/\(1-totalPct\)/);
  assert.match(html, /Usar este preço no anúncio/);
});
