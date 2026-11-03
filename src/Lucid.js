function getLucidAuthUrl() {
  const scriptProps = PropertiesService.getScriptProperties();
  const clientId = scriptProps.getProperty('LUCID_CLIENT_ID');
  const scriptId = ScriptApp.getScriptId();
  
  // 1. Use the official Google Apps Script OAuth callback URL
  const redirectUri = `https://script.google.com/macros/d/${scriptId}/usercallback`;
  
  // 2. Create a secure state token that routes the Lucidchart response to 'authCallback'
  const stateToken = ScriptApp.newStateToken()
    .withMethod('authCallback')
    .withTimeout(3600)
    .createToken();
  
  return `https://lucid.app/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateToken}&scope=lucidchart.document.content&response_type=code`;
}

// 3. This function automatically catches the redirect, bypassing the parameter drop
function authCallback(e) {
  if (e.parameter.code) {
    const scriptProps = PropertiesService.getScriptProperties();
    const scriptId = ScriptApp.getScriptId();
    
    const payload = {
      client_id: scriptProps.getProperty('LUCID_CLIENT_ID'),
      client_secret: scriptProps.getProperty('LUCID_CLIENT_SECRET'),
      code: e.parameter.code,
      grant_type: 'authorization_code',
      redirect_uri: `https://script.google.com/macros/d/${scriptId}/usercallback`
    };

    try {
      const response = UrlFetchApp.fetch('https://api.lucid.co/oauth2/token', {
        method: 'post',
        payload: payload
      });

      const tokens = JSON.parse(response.getContentText());
      PropertiesService.getUserProperties().setProperty('LUCID_ACCESS_TOKEN', tokens.access_token);
      if (tokens.refresh_token) {
        PropertiesService.getUserProperties().setProperty('LUCID_REFRESH_TOKEN', tokens.refresh_token);
      }

      return HtmlService.createHtmlOutput(
        '<h3 style="font-family:sans-serif; color: green;">' +
        'Authorization successful. You can close this tab and generate diagrams.' +
        '</h3>'
      );
    } catch (error) {
      return HtmlService.createHtmlOutput(
        '<h3 style="font-family:sans-serif; color: red;">Authorization failed: ' + error.message + '</h3>'
      );
    }
  }
  return HtmlService.createHtmlOutput(
    'Missing authorization code. Raw data received from Lucidchart: ' + 
    JSON.stringify(e.parameter)
  );
}

function doGet(e) {
  // Enforce Costco domain restriction
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  if (!userEmail.endsWith('@costco.com')) {
    return HtmlService.createHtmlOutput(
      '<h3 style="font-family:sans-serif; color: red;">' +
      'Access Denied: Only authenticated @costco.com accounts are permitted to connect to Lucidchart.' +
      '</h3>'
    );
  }

  // Render the Authorization UI
  const authUrl = getLucidAuthUrl();
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif; padding: 20px;">' +
    '<h3>Lucidchart Integration</h3>' +
    '<p>You must authorize the application before generating diagrams.</p>' +
    '<a href="' + authUrl + '" target="_top" style="display:inline-block; padding: 10px 15px; background: #0073e6; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">Connect to Lucidchart</a>' +
    '</div>'
  );
}


function pushPayloadToLucid(architectureData) {
  const token = PropertiesService.getUserProperties().getProperty('LUCID_ACCESS_TOKEN');
  if (!token) throw new Error('Not authenticated. Please authorize Lucidchart first.');

  const packageId = PropertiesService.getScriptProperties().getProperty('LUCID_PACKAGE_ID');
  if (!packageId) throw new Error('Script property LUCID_PACKAGE_ID is not set.');

  const bootstrap = buildBootstrapPayload(architectureData);

  const documentJson = {
    "version": 1,
    "pages": bootstrap.diagrams.map(d => ({ "id": d.key, "title": d.pageTitle })),
    "extensionBootstrapData": {
      "packageId": packageId,
      "extensionName": "csa-elk-renderer",
      "minimumVersion": "1.0.0",
      "data": {
        "csaPayload": JSON.stringify(bootstrap)
      }
    }
  };

  const jsonBlob = Utilities.newBlob(JSON.stringify(documentJson), 'application/json', 'document.json');
  const zipBlob = Utilities.zip([jsonBlob], 'import.lucid')
    .setContentType('x-application/vnd.lucid.standardImport');

  const response = UrlFetchApp.fetch('https://api.lucid.co/v1/documents', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Lucid-Api-Version': '1'
    },
    payload: {
      "product": "lucidchart",
      "title": bootstrap.title,
      "file": zipBlob
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 400) {
    throw new Error(`API Error ${response.getResponseCode()}: ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText());
}