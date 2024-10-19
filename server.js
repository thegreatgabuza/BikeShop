require('dotenv').config(); // Add this at the top of the file

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { auth } = require('express-openid-connect');
const { createClient } = require('tigerbeetle-node');
const WalletManager = require('./WalletManager');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Auth0 configuration
const authConfig = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.AUTH0_SECRET,
  baseURL: 'http://localhost:3000',
  clientID: 'S0zg526dk4eW2jRepG9PGsU2pzhsE4mP',
  issuerBaseURL: 'https://dev-erqur7jerx4wtawx.us.auth0.com'
};

// Only use Auth0 if the secret is set
if (process.env.AUTH0_SECRET) {
  app.use(auth(authConfig));
} else {
  console.warn('AUTH0_SECRET not set. Skipping Auth0 middleware.');
}

// TigerBeetle setup
const client = createClient({
  cluster_id: 0n,
  replica_addresses: ['127.0.0.1:3000']
});

const walletManager = new WalletManager(client);

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Serve storeManager.html
app.get('/storeManager', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storeManager.html'));
});

// QR Code generation endpoint
app.get('/generateQR', async (req, res) => {
  try {
    const { price } = req.query; // Get the price from query parameters
    if (!price) {
      return res.status(400).send('Price is required');
    }

    const qrData = `Price: ${price}`; // Data to encode in the QR code
    const qrCodeImage = await QRCode.toDataURL(qrData); // Generate QR code

    res.send(`<img src="${qrCodeImage}" alt="QR Code"/>`); // Send QR code as an image
  } catch (err) {
    console.error('Error generating QR code:', err);
    res.status(500).send('Internal Server Error');
  }
});



// Load store manager details
let storeManagerDetails = {};
try {
  storeManagerDetails = JSON.parse(fs.readFileSync('storeManagerDetails.json', 'utf8'));
} catch (error) {
  console.error('Error loading store manager details:', error);
}

// API endpoint for Web Monetization
app.post('/api/web-monetization', async (req, res) => {
  try {
    const { product, priceInRand, country, senderPointer } = req.body;
    const userId = req.oidc?.user?.sub || 'anonymous'; // Get user ID from Auth0 if available

    // Convert RAND to local currency
    const localCurrency = await convertCurrency(priceInRand, 'ZAR', country);

    // Create or get user wallet
    const userWallet = await walletManager.getOrCreateWallet(userId);

    // Generate a payment pointer for the receiver (bike shop)
    const receiverPointer = storeManagerDetails.paymentPointer;

    // Create a pending transaction in TigerBeetle
    const transactionId = await walletManager.createPendingTransaction(userWallet.id, BigInt(priceInRand * 100)); // Convert to cents

    // Initiate Interledger payment
    const paymentResult = await initiateInterledgerPayment(senderPointer, receiverPointer, priceInRand);

    res.json({ 
      success: true, 
      message: 'Transaction initiated', 
      priceInRand, 
      localCurrency,
      paymentResult
    });

    // Monitor the transaction (this should be implemented properly in a production environment)
    setTimeout(async () => {
      await walletManager.finalizeTransaction(transactionId);
    }, 30000); // Simulate a 30-second payment window

  } catch (error) {
    console.error('Error processing Web Monetization transaction:', error);
    res.status(500).json({ error: 'An error occurred while processing the payment' });
  }
});

// Store manager settings endpoint
app.post('/api/store-manager-settings', (req, res) => {
  const { paymentPointer } = req.body;
  storeManagerDetails = { 
    paymentPointer, 
    interledgerSecret: 'C:\\Users\\IT STAFF\\BikeShop\\cert.pem' 
  };
  fs.writeFileSync('storeManagerDetails.json', JSON.stringify(storeManagerDetails));
  res.json({ success: true, message: 'Store manager details updated' });
});

// Currency conversion endpoint
app.get('/api/convert-currency', async (req, res) => {
  try {
    const { amount, from, to } = req.query;
    const convertedAmount = await convertCurrency(amount, from, to);
    res.json({ convertedAmount });
  } catch (error) {
    console.error('Error converting currency:', error);
    res.status(500).json({ error: 'An error occurred while converting currency' });
  }
});

async function convertCurrency(amount, from, to) {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY; // You'll need to get an API key from an exchange rate service
  const url = `https://api.exchangerate-api.com/v4/latest/${from}`;

  try {
    const response = await axios.get(url);
    const rate = response.data.rates[to];
    return (amount * rate).toFixed(2);
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    throw new Error('Failed to convert currency');
  }
}

async function initiateInterledgerPayment(senderPointer, receiverPointer, amount) {
  // This is a placeholder function. In a real application, you would integrate with
  // the Interledger protocol to initiate the payment using the secret file.
  const interledgerSecret = storeManagerDetails.interledgerSecret;
  console.log(`Using Interledger secret file: ${interledgerSecret}`);
  
  // Here you would use the secret file to authenticate and initiate the payment
  // For now, we'll return a dummy result
  return {
    success: true,
    transactionId: 'il-' + Math.random().toString(36).substr(2, 9),
    message: `Payment of ${amount} from ${senderPointer} to ${receiverPointer} initiated using secret file`
  };
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
