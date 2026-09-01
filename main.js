const squirrelEvents = require('./squirrelEvents');

if (squirrelEvents()) {
  return;
}
const { app, BrowserWindow, session } = require('electron');
const express = require('express');
const path = require('path');
const http = require('http');

let mainWindow;
let server;
let PORT = 3000;

// 1. Démarrer un mini-serveur local
const startLocalServer = () => {
    const expressApp = express();
    expressApp.use(express.static(__dirname));
    server = http.createServer(expressApp);
    server.listen(PORT, () => {
        console.log(`Serveur local démarré sur http://localhost:${PORT}`);
        createWindow();
    });
};

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: "Backroom by FMR",
        icon: path.join(__dirname, 'Logo-FMR.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // Désactive CORS strict
        },
        autoHideMenuBar: true
    });

    // 2. HACK USER AGENT (Pour la connexion Google)
    const userAgent = mainWindow.webContents.getUserAgent();
    mainWindow.webContents.setUserAgent(userAgent.replace(/Electron\/[0-9\.]+\s/, ''));

    // 3. GESTION DES HEADERS ET DES IMAGES (CORRECTIF MAJEUR)
    
    // Définition des URLs Google Drive / Images
    const googleFilter = {
        urls: [
            '*://drive.google.com/*', 
            '*://docs.google.com/*', 
            '*://*.googleusercontent.com/*'
        ]
    };

    // A. Nettoyage AVANT envoi (Request) : On cache l'origine pour éviter le blocage "Hotlink"
    session.defaultSession.webRequest.onBeforeSendHeaders(googleFilter, (details, callback) => {
        const { requestHeaders } = details;
        delete requestHeaders['Referer'];
        delete requestHeaders['Origin'];
        callback({ requestHeaders });
    });

    // B. Nettoyage A LA RECEPTION (Response) : On supprime les headers de sécurité qui bloquent l'affichage
    session.defaultSession.webRequest.onHeadersReceived(googleFilter, (details, callback) => {
        const { responseHeaders } = details;
        
        // On autorise tout le monde (CORS)
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        
        // On supprime les interdictions d'affichage en iframe ou img
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['content-security-policy'];
        
        callback({ 
            responseHeaders,
            statusLine: details.statusLine 
        });
    });

    // C. Headers globaux pour l'application (Nécessaire pour Google Picker / Auth)
    // On exclut les URLs Google Drive ici pour ne pas écraser la configuration précédente (B)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const url = details.url;
        if (url.includes('drive.google.com') || url.includes('googleusercontent.com')) {
            // Si c'est une image drive, on laisse le gestionnaire (B) s'en occuper
            callback({ responseHeaders: details.responseHeaders });
            return;
        }

        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Cross-Origin-Opener-Policy': ['unsafe-none'],
                'Cross-Origin-Embedder-Policy': ['unsafe-none'],
                'Cross-Origin-Resource-Policy': ['cross-origin']
            }
        });
    });

    // 4. Charger l'application
    mainWindow.loadURL(`http://localhost:${PORT}/index.html`);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
};

app.whenReady().then(startLocalServer);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});