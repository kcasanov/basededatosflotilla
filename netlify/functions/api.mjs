const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby5hk0KM34Ts8VNhX9uF5cAbNhzL6ygQLIUJBcM3aPXuQSnXWuNWH1mIA3L5QnW5tea/exec";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, message: "Método no permitido" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  try {
    const body = await request.text();

    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body,
      redirect: "follow"
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.ok ? 200 : 502,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      message: "No se pudo contactar el backend"
    }), {
      status: 502,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};

export const config = {
  path: "/api"
};
