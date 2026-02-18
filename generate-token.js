const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

// Load client secrets
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  'http://localhost' // Redirect URI for desktop app
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose'],
  prompt: 'consent' // Force to get refresh token
});

console.log('Authorize this app by visiting this URL:', authUrl);

// Create interface to get code from user
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter the code from that page here: ', async (code) => {
  rl.close();
  
  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Tokens received!');
    console.log('\n📋 Add these to your Render environment variables:');
    console.log(`GMAIL_CLIENT_ID=${client_id}`);
    console.log(`GMAIL_CLIENT_SECRET=${client_secret}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GMAIL_ACCESS_TOKEN=${tokens.access_token}`);
    
    // Also save to file for backup
    fs.writeFileSync('token.json', JSON.stringify(tokens));
    console.log('\n✅ Tokens also saved to token.json');
  } catch (error) {
    console.error('❌ Error getting tokens:', error.message);
  }
});
