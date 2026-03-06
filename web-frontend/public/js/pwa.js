// PWA Registration and Installation
class PWAInstall {
  constructor() {
    this.deferredPrompt = null;
    this.installButton = null;
    this.init();
  }

  init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
          .then(registration => {
            console.log('Service Worker registered successfully:', registration.scope);

            // Handle updates
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  this.showUpdateNotification();
                }
              });
            });
          })
          .catch(error => {
            console.log('Service Worker registration failed:', error);
          });
      });
    }

    // Handle install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('PWA install prompt triggered');
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButton();
    });

    // Handle successful installation
    window.addEventListener('appinstalled', (evt) => {
      console.log('PWA was installed successfully');
      this.hideInstallButton();
      this.showInstallSuccess();
    });

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      console.log('PWA is running in standalone mode');
    }
  }

  showInstallButton() {
    // Create install button if it doesn't exist
    if (!this.installButton) {
      this.installButton = document.createElement('button');
      this.installButton.id = 'pwa-install-btn';
      this.installButton.innerHTML = '<i class="fas fa-download"></i> Install App';
      this.installButton.className = 'pwa-install-btn';
      this.installButton.onclick = () => this.installPWA();

      // Add to page
      const nav = document.querySelector('.navbar .nav-container');
      if (nav) {
        nav.appendChild(this.installButton);
      }
    }

    this.installButton.style.display = 'inline-block';
  }

  hideInstallButton() {
    if (this.installButton) {
      this.installButton.style.display = 'none';
    }
  }

  async installPWA() {
    if (!this.deferredPrompt) return;

    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('User accepted the PWA install prompt');
    } else {
      console.log('User dismissed the PWA install prompt');
    }

    this.deferredPrompt = null;
    this.hideInstallButton();
  }

  showInstallSuccess() {
    // Show success message
    const notification = document.createElement('div');
    notification.className = 'pwa-install-success';
    notification.innerHTML = '<i class="fas fa-check-circle"></i> App installed successfully!';
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  showUpdateNotification() {
    // Show update available notification
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';
    notification.innerHTML = `
      <div class="pwa-update-content">
        <i class="fas fa-sync-alt"></i>
        <span>Update available! Refresh to get the latest version.</span>
        <button onclick="location.reload()">Refresh</button>
      </div>
    `;
    document.body.appendChild(notification);
  }
}

// Network status monitoring
class NetworkStatus {
  constructor() {
    this.isOnline = navigator.onLine;
    this.init();
  }

  init() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.showOnlineStatus();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.showOfflineStatus();
    });

    this.updateStatusIndicator();
  }

  showOnlineStatus() {
    this.showStatusNotification('Back online!', 'success');
  }

  showOfflineStatus() {
    this.showStatusNotification('You are offline. Some features may be limited.', 'warning');
  }

  showStatusNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `network-status-notification ${type}`;
    notification.innerHTML = `<i class="fas fa-${type === 'success' ? 'wifi' : 'exclamation-triangle'}"></i> ${message}`;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  updateStatusIndicator() {
    // Update any network status indicators in the UI
    const indicators = document.querySelectorAll('.network-status');
    indicators.forEach(indicator => {
      indicator.className = `network-status ${this.isOnline ? 'online' : 'offline'}`;
    });
  }
}

// Initialize PWA features when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PWAInstall();
  new NetworkStatus();
});