const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Test route
app.get('/', (req, res) => {
  res.send('Webhook server is running 🚀');
});

// PayPal Webhook
app.post('/paypal-webhook', (req, res) => {
  const event = req.body;

  console.log('Webhook received:', event.event_type);

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const payment = event.resource;

    const data = {
      transaction_id: payment.id,
      value: payment.amount?.value,
      currency: payment.amount?.currency_code,
      email: payment.payer?.email_address
    };

    console.log('PAYMENT CONFIRMED:', data);

    // هنا لاحقًا سنضيف TikTok + Meta server-side
  }

  res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});