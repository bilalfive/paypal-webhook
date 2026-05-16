const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// ==============================
// 🔥 DUPLICATE PROTECTION
// ==============================
const processedEvents = new Set();

// تنظيف الذاكرة كل ساعة
setInterval(() => {
  processedEvents.clear();
  console.log("🧹 Duplicate cache cleared");
}, 1000 * 60 * 60);

// ==============================
// 🔥 HELPERS
// ==============================
function sha256(value) {
  if (!value) return undefined;

  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

// ==============================
// 🔥 META CAPI
// ==============================
async function sendToMetaCAPI(event, req) {
  try {
    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

    if (!PIXEL_ID || !ACCESS_TOKEN) {
      console.log("❌ Missing META ENV variables");
      return;
    }

    const url = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events`;

    const payload = {
      data: [
        {
          event_name: "Purchase",

          // 🔥 مهم جداً لمنع التكرار
          event_id: event.transaction_id,

          event_time: Math.floor(Date.now() / 1000),

          action_source: "website",

          user_data: {
            em: sha256(event.email),

            client_ip_address:
              req.headers["x-forwarded-for"] ||
              req.socket.remoteAddress,

            client_user_agent:
              req.headers["user-agent"]
          },

          custom_data: {
            currency: event.currency,
            value: Number(event.value),

            content_ids: [
              event.content_id || "iptv_1m"
            ],

            content_type: "product"
          }
        }
      ]
    };

    const response = await axios.post(
      url,
      payload,
      {
        params: {
          access_token: ACCESS_TOKEN
        }
      }
    );

    console.log("📘 Meta CAPI SUCCESS");
    console.log(response.data);

  } catch (err) {
    console.log(
      "❌ Meta CAPI Error:",
      err.response?.data || err.message
    );
  }
}

// ==============================
// 🔥 TIKTOK EVENTS API
// ==============================
async function sendToTikTok(event, req) {
  try {
    const PIXEL_CODE = process.env.TIKTOK_PIXEL_ID;
    const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

    if (!PIXEL_CODE || !ACCESS_TOKEN) {
      console.log("⚠️ TikTok ENV missing");
      return;
    }

    const payload = {
      event_source: "web",

      event_source_id: PIXEL_CODE,

      data: [
        {
          event: "CompletePayment",

          event_id: event.transaction_id,

          event_time: Math.floor(Date.now() / 1000),

          user: {
            email: sha256(event.email),

            ip:
              req.headers["x-forwarded-for"] ||
              req.socket.remoteAddress,

            user_agent:
              req.headers["user-agent"]
          },

          properties: {
            value: Number(event.value),
            currency: event.currency,

            content_id:
              event.content_id || "iptv_1m",

            content_type: "product"
          }
        }
      ]
    };

    await axios.post(
      "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      payload,
      {
        headers: {
          "Access-Token": ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("📲 TikTok Events API SUCCESS");

  } catch (err) {
    console.log(
      "❌ TikTok Error:",
      err.response?.data || err.message
    );
  }
}

// ==============================
// 🔥 GA4 MEASUREMENT PROTOCOL
// ==============================
async function sendToGA4(event) {
  try {
    const MEASUREMENT_ID =
      process.env.GA4_MEASUREMENT_ID;

    const API_SECRET =
      process.env.GA4_API_SECRET;

    if (!MEASUREMENT_ID || !API_SECRET) {
      console.log("⚠️ GA4 ENV missing");
      return;
    }

    const payload = {
      client_id:
        event.transaction_id,

      events: [
        {
          name: "purchase",

          params: {
            transaction_id:
              event.transaction_id,

            currency:
              event.currency,

            value:
              Number(event.value),

            items: [
              {
                item_id:
                  event.content_id ||
                  "iptv_1m",

                item_name:
                  "IPTV Subscription",

                quantity: 1,

                price:
                  Number(event.value)
              }
            ]
          }
        }
      ]
    };

    await axios.post(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      payload
    );

    console.log("📊 GA4 SUCCESS");

  } catch (err) {
    console.log(
      "❌ GA4 Error:",
      err.response?.data || err.message
    );
  }
}

// ==============================
// 🔥 PAYPAL WEBHOOK
// ==============================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body;

    console.log(
      "📩 Webhook received:",
      event.event_type
    );

    // 🔥 فقط الدفع المكتمل
    if (
      event.event_type !==
      "PAYMENT.CAPTURE.COMPLETED"
    ) {
      return res
        .status(200)
        .send("ignored");
    }

    const capture = event.resource;

    // ==============================
    // 🔥 TRANSACTION ID
    // ==============================
    const transaction_id =
      capture?.id;

    if (!transaction_id) {
      console.log(
        "❌ Missing transaction ID"
      );

      return res
        .status(200)
        .send("missing id");
    }

    // ==============================
    // 🔥 DUPLICATE PROTECTION
    // ==============================
    if (
      processedEvents.has(
        transaction_id
      )
    ) {
      console.log(
        "⚠️ Duplicate ignored:",
        transaction_id
      );

      return res
        .status(200)
        .send("duplicate");
    }

    processedEvents.add(
      transaction_id
    );

    // ==============================
    // 💰 PAYMENT DATA
    // ==============================
    const amount =
      capture?.amount?.value || "0";

    const currency =
      capture?.amount
        ?.currency_code || "USD";

    // ==============================
    // 📧 EMAIL EXTRACTION
    // ==============================
    let email = null;

    email =
      capture?.payer
        ?.email_address ||
      capture?.payment_source
        ?.paypal?.email_address ||
      null;

    // ==============================
    // 📦 PURCHASE OBJECT
    // ==============================
    const purchaseEvent = {
      transaction_id,

      value:
        Number(amount),

      currency,

      email,

      content_id:
        "iptv_1m",

      timestamp:
        Date.now()
    };

    console.log(
      "💰 PURCHASE CONFIRMED:"
    );

    console.log(
      purchaseEvent
    );

    // ==============================
    // 🚀 SEND EVENTS
    // ==============================
    await sendToMetaCAPI(
      purchaseEvent,
      req
    );

    await sendToTikTok(
      purchaseEvent,
      req
    );

    await sendToGA4(
      purchaseEvent
    );

    return res
      .status(200)
      .send("ok");

  } catch (error) {
    console.log(
      "❌ Webhook Error:",
      error.message
    );

    return res
      .status(200)
      .send("error handled");
  }
});

// ==============================
// 🚀 SERVER START
// ==============================
app.listen(
  process.env.PORT || 3000,
  () => {
    console.log(
      "🚀 Webhook server running"
    );
  }
);