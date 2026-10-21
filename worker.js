const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

const encoder = new TextEncoder();

function randomHex(length = 32) {
  const bytes = crypto.getRandomValues(
    new Uint8Array(length)
  );

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value)
  );

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(
    new Uint8Array(16)
  );

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

  const hex = bytes =>
    Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

  return `pbkdf2-sha256$600000$${hex(salt)}$${hex(
    new Uint8Array(bits)
  )}`;
}

async function sendEmail(env, to, subject, html) {
  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Orion Realm <onboarding@resend.dev>",
        to: [to],
        subject,
        html
      })
    }
  );

  if (!response.ok) {
    // Do not expose API credentials or provider errors publicly.
    console.error("Email delivery failed:", response.status);
    throw new Error("Email delivery failed");
  }
}

async function createVerification(env, user, origin) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + 1800;

  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM email_verification_tokens WHERE user_id = ?"
    ).bind(user.id),

    env.DB.prepare(`
      INSERT INTO email_verification_tokens
        (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).bind(user.id, tokenHash, expiresAt)
  ]);

  const link =
    `${origin}/api/verify?token=${encodeURIComponent(token)}`;

  await sendEmail(
    env,
    user.email,
    "Verify your Orion Realm account",
    `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <h1>Welcome to Orion Realm</h1>
        <p>Click below to verify your email address.</p>
        <p>
          <a href="${link}"
             style="display:inline-block;padding:12px 20px;
                    background:#171923;color:white;
                    text-decoration:none;border-radius:8px">
            Verify Email
          </a>
        </p>
        <p>This link expires in 30 minutes.</p>
        <p>If you didn't request this registration, ignore this email.</p>
      </div>
    `
  );
}

async function generateUsername(env) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const username = `OR-${randomHex(6).toUpperCase()}`;

    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE username = ?"
    ).bind(username).first();

    if (!existing) return username;
  }

  throw new Error("Unable to generate username");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Backend health check
      if (path === "/api/health") {
        return json({
          status: "online",
          project: "Orion Realm",
          backend: "operational"
        });
      }

      // Registration
      if (path === "/api/register") {
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
          return json({
            error: "Password must contain 12–128 characters"
          }, 400);
        }

        const existing = await env.DB.prepare(
          "SELECT id, email, email_verified FROM users WHERE email = ?"
        ).bind(email).first();

        if (existing?.email_verified) {
          return json({
            error: "Unable to register with those details"
          }, 400);
        }

        let user;

        if (existing) {
          const passwordHash = await hashPassword(password);

          await env.DB.prepare(
            "UPDATE users SET password_hash = ? WHERE id = ?"
          ).bind(passwordHash, existing.id).run();

          user = existing;
        } else {
          const passwordHash = await hashPassword(password);

          const result = await env.DB.prepare(`
            INSERT INTO users
              (email, password_hash, email_verified)
            VALUES (?, ?, 0)
          `).bind(email, passwordHash).run();

          user = {
            id: result.meta.last_row_id,
            email
          };
        }

        await createVerification(env, user, url.origin);

        return json({
          success: true,
          message: "Check your email for a verification link."
        }, 201);
      }

      // Email verification and username delivery
      if (path === "/api/verify") {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed" }, 405);
        }

        const token = url.searchParams.get("token");

        if (!token || !/^[a-f0-9]{64}$/.test(token)) {
          return json({ error: "Invalid verification link" }, 400);
        }

        const tokenHash = await sha256(token);

        const record = await env.DB.prepare(`
          SELECT
            t.user_id,
            t.expires_at,
            u.email,
            u.email_verified,
            u.username
          FROM email_verification_tokens t
          JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = ?
        `).bind(tokenHash).first();

        if (!record) {
          return json({
            error: "Invalid or already-used verification link"
          }, 400);
        }

        if (record.expires_at < Math.floor(Date.now() / 1000)) {
          await env.DB.prepare(
            "DELETE FROM email_verification_tokens WHERE token_hash = ?"
          ).bind(tokenHash).run();

          return json({
            error: "Verification link expired. Please register again."
          }, 400);
        }

        let username = record.username;

        if (!record.email_verified) {
          username = await generateUsername(env);

          await env.DB.prepare(`
            UPDATE users
            SET username = ?, email_verified = 1
            WHERE id = ? AND email_verified = 0
          `).bind(username, record.user_id).run();
        }

        // Keep the token until delivery succeeds so a failed
        // username email can be retried with the same link.
        await sendEmail(
          env,
          record.email,
          "Your Orion Realm username",
          `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
              <h1>Your email is verified!</h1>
              <p>Your Orion Realm username is:</p>
              <p style="font-size:24px;font-weight:bold">
                ${username}
              </p>
              <p>Use this username and your password to sign in.</p>
              <p>Keep your username private.</p>
            </div>
          `
        );

        await env.DB.prepare(
          "DELETE FROM email_verification_tokens WHERE token_hash = ?"
        ).bind(tokenHash).run();

        return new Response(
          `<!doctype html>
          <html lang="en">
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Orion Realm — Email Verified</title>
          <body style="font-family:Arial,sans-serif;background:#08090d;color:white;
                       min-height:100vh;display:grid;place-items:center">
            <main style="text-align:center;padding:24px">
              <h1>Email verified</h1>
              <p>Your account is verified.</p>
              <p>Your username has been sent to your email.</p>
              <p>You can now return to Orion Realm.</p>
            </main>
          </body>
          </html>`,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store"
            }
          }
        );
      }

      // Serve the existing website
      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Orion Realm request failed:", error.message);

      return json({
        error: "The request could not be completed. Please try again."
      }, 500);
    }
  }
};
