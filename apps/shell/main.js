const { app, BrowserWindow } = require('electron');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#05080d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // Keep demo simple; harden later.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  const url = process.env.ACHELION_URL || 'http://127.0.0.1:3000';
  win.loadURL(url);

  // Optional: open devtools in dev
  if (process.env.NODE_ENV !== 'production') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
