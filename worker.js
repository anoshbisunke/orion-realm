const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 600000,
      hash: "SHA-256"
    },
    key,
    256
  );

  const toHex = bytes =>
    Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

  return `pbkdf2-sha256$600000$${toHex(salt)}$${toHex(new Uint8Array(bits))}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        status: "online",
        project: "Orion Realm",
        backend: "operational"
      });
    }

    if (url.pathname === "/api/register") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const email =
        typeof body.email === "string"
          ? body.email.trim().toLowerCase()
          : "";

      const password =
        typeof body.password === "string"
          ? body.password
          : "";

      if (
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return json({ error: "Enter a valid email address" }, 400);
      }

      if (password.length < 12 || password.length > 128) {
        return json(
          { error: "Password must contain 12–128 characters" },
          400
        );
      }

      try {
        const existing = await env.DB
          .prepare("SELECT id FROM users WHERE email = ?")
          .bind(email)
          .first();

        if (existing) {
          return json(
            { error: "Unable to register with those details" },
            400
          );
        }

        const passwordHash = await hashPassword(password);

        await env.DB
          .prepare(
            `INSERT INTO users
              (email, password_hash, email_verified)
             VALUES (?, ?, 0)`
          )
          .bind(email, passwordHash)
          .run();

        return json(
          {
            success: true,
            message:
              "Registration received. Email verification must be completed before account activation."
          },
          201
        );
      } catch {
        return json(
          { error: "Registration could not be completed" },
          500
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
