/**
 * Visa Guide AI - Data Sync Module
 * Handles real-time data synchronization between local state and Firestore cloud database
 * Uses real Firebase Firestore
 */

class DataSync {
    constructor() {
        this.db = null;
        this.auth = null;
        this.userId = null;
        this.unsubscribers = [];
        this.syncStatus = 'synced'; // synced, syncing, offline, error
        this.syncListeners = [];
        this.initialized = false;
        
        // Debounce settings
        this.writeDebounceMs = 500;
        this.pendingWrites = new Map();
        
        // Initialize
        this._init();
    }
    
    /**
     * Initialize data sync
     */
    async _init() {
        // Wait for Firebase to be ready
        if (typeof FirebaseCore === 'undefined') {
            console.error('FirebaseCore not found. Make sure firebase-config.js is loaded.');
            return;
        }
        
        // Initialize Firebase if not already done
        if (!FirebaseCore.isInitialized()) {
            FirebaseCore.initialize(firebaseConfig);
        }
        
        this.db = FirebaseCore.getDb();
        this.auth = FirebaseCore.getAuth();
        this.initialized = true;
        
        console.log('DataSync initialized with real Firestore');
        
        // Listen for auth state changes
        if (this.auth && this.auth.onAuthStateChanged) {
            this.auth.onAuthStateChanged((user) => {
                if (user) {
                    this.userId = user.uid;
                    this._startSync();
                    this._notifySyncListeners('syncing', 'Connecting...');
                } else {
                    this.userId = null;
                    this._stopSync();
                    this._notifySyncListeners('offline', 'Not connected');
                }
            });
        }
        
        // Listen for online/offline status
        window.addEventListener('online', () => {
            this._notifySyncListeners('syncing', 'Reconnecting...');
            setTimeout(() => {
                if (this.userId) {
                    this._startSync();
                }
            }, 1000);
        });
        
        window.addEventListener('offline', () => {
            this._notifySyncListeners('offline', 'Offline mode');
        });
    }
    
    /**
     * Start syncing user data
     */
    async _startSync() {
        if (!this.userId || !this.db) {
            console.warn('Cannot start sync: no user or database');
            return;
        }
        
        console.log('Starting data sync for user:', this.userId);
        
        // Subscribe to user profile changes
        this._subscribeToProfile();
        
        // Subscribe to forms data
        this._subscribeToForms();
        
        // Subscribe to documents
        this._subscribeToDocuments();
        
        // Subscribe to settings
        this._subscribeToSettings();
        
        // Initial sync complete
        setTimeout(() => {
            this._notifySyncListeners('synced', 'All changes saved');
        }, 1500);
    }
    
    /**
     * Stop syncing and cleanup
     */
    _stopSync() {
        this.unsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        this.unsubscribers = [];
        console.log('Data sync stopped');
    }
    
    /**
     * Subscribe to user profile changes
     */
    _subscribeToProfile() {
        if (!this.db || !this.userId) return;
        
        try {
            const profileDocRef = this.db.collection('users').doc(this.userId);
            
            const unsubscribe = profileDocRef.onSnapshot((doc) => {
                if (doc.exists && doc.data()) {
                    const data = doc.data();
                    this._updateProfileUI(data);
                }
            }, (error) => {
                console.error('Error subscribing to profile:', error);
            });
            
            this.unsubscribers.push(unsubscribe);
        } catch (error) {
            console.error('Error subscribing to profile:', error);
        }
    }
    
    /**
     * Subscribe to forms data changes
     */
    _subscribeToForms() {
        if (!this.db || !this.userId) return;
        
        try {
            const formsDocRef = this.db.collection('users').doc(this.userId);
            
            const unsubscribe = formsDocRef.onSnapshot((doc) => {
                if (doc.exists && doc.data()) {
                    const data = doc.data();
                    // Check if it has forms data
                    if (data.forms || data.progress) {
                        this._updateFormsUI(data);
                    }
                }
            }, (error) => {
                console.error('Error subscribing to forms:', error);
            });
            
            this.unsubscribers.push(unsubscribe);
        } catch (error) {
            console.error('Error subscribing to forms:', error);
        }
    }
    
    /**
     * Subscribe to documents changes
     */
    _subscribeToDocuments() {
        if (!this.db || !this.userId) return;
        
        try {
            const docsDocRef = this.db.collection('users').doc(this.userId);
            
            const unsubscribe = docsDocRef.onSnapshot((doc) => {
                if (doc.exists && doc.data()) {
                    const data = doc.data();
                    if (data.documents) {
                        this._updateDocumentsUI(data);
                    }
                }
            }, (error) => {
                console.error('Error subscribing to documents:', error);
            });
            
            this.unsubscribers.push(unsubscribe);
        } catch (error) {
            console.error('Error subscribing to documents:', error);
        }
    }
    
    /**
     * Subscribe to settings changes
     */
    _subscribeToSettings() {
        if (!this.db || !this.userId) return;
        
        try {
            const settingsDocRef = this.db.collection('users').doc(this.userId);
            
            const unsubscribe = settingsDocRef.onSnapshot((doc) => {
                if (doc.exists && doc.data()) {
                    const data = doc.data();
                    if (data.settings) {
                        this._applySettings(data.settings);
                    }
                }
            }, (error) => {
                console.error('Error subscribing to settings:', error);
            });
            
            this.unsubscribers.push(unsubscribe);
        } catch (error) {
            console.error('Error subscribing to settings:', error);
        }
    }
    
    /**
     * Save form data with debouncing
     */
    async saveFormData(collection, docId, fieldName, value) {
        if (!this.userId) {
            // Fallback to localStorage if not logged in
            this._saveToLocalStorage(collection, docId, fieldName, value);
            return;
        }
        
        this._notifySyncListeners('syncing', 'Saving...');
        
        // Debounce writes
        const key = `${collection}.${docId}.${fieldName}`;
        if (this.pendingWrites.has(key)) {
            clearTimeout(this.pendingWrites.get(key));
        }
        
        const timeoutId = setTimeout(async () => {
            try {
                const data = {};
                data[fieldName] = value;
                data.lastUpdated = new Date().toISOString();
                
                // Use Firestore updateDocument
                await FirebaseCore.updateDocument(`users/${this.userId}`, data);
                
                this._notifySyncListeners('synced', 'All changes saved');
            } catch (error) {
                console.error('Error saving data:', error);
                this._notifySyncListeners('error', 'Sync failed');
                // Fallback to localStorage
                this._saveToLocalStorage(collection, docId, fieldName, value);
            }
            this.pendingWrites.delete(key);
        }, this.writeDebounceMs);
        
        this.pendingWrites.set(key, timeoutId);
    }
    
    /**
     * Save complete form data
     */
    async saveCompleteFormData(formData) {
        if (!this.userId) {
            // Fallback to localStorage
            localStorage.setItem('formData', JSON.stringify(formData));
            return;
        }
        
        this._notifySyncListeners('syncing', 'Saving...');
        
        try {
            const data = {
                forms: formData,
                lastUpdated: new Date().toISOString()
            };
            
            await FirebaseCore.updateDocument(`users/${this.userId}`, data);
            this._notifySyncListeners('synced', 'All changes saved');
            return { success: true };
        } catch (error) {
            console.error('Error saving form data:', error);
            this._notifySyncListeners('error', 'Sync failed');
            // Fallback to localStorage
            localStorage.setItem('formData', JSON.stringify(formData));
            return { success: false, error: error };
        }
    }
    
    /**
     * Save progress data
     */
    async saveProgressData(progressData) {
        if (!this.userId) {
            // Fallback to localStorage
            localStorage.setItem('progressData', JSON.stringify(progressData));
            return;
        }
        
        try {
            const data = {
                progress: progressData,
                lastUpdated: new Date().toISOString()
            };
            
            await FirebaseCore.updateDocument(`users/${this.userId}`, data);
            console.log('Progress saved to Firestore');
            return { success: true };
        } catch (error) {
            console.error('Error saving progress:', error);
            // Fallback to localStorage
            localStorage.setItem('progressData', JSON.stringify(progressData));
            return { success: false, error: error };
        }
    }
    
    /**
     * Save user settings
     */
    async saveSettings(settings) {
        if (!this.userId) {
            // Fallback to localStorage
            localStorage.setItem('settings', JSON.stringify(settings));
            return;
        }
        
        try {
            const data = {
                settings: settings,
                lastUpdated: new Date().toISOString()
            };
            
            await FirebaseCore.updateDocument(`users/${this.userId}`, data);
            console.log('Settings saved to Firestore');
            return { success: true };
        } catch (error) {
            console.error('Error saving settings:', error);
            // Fallback to localStorage
            localStorage.setItem('settings', JSON.stringify(settings));
            return { success: false, error: error };
        }
    }
    
    /**
     * Save data to localStorage as fallback
     */
    _saveToLocalStorage(collection, docId, fieldName, value) {
        const key = `${collection}_${docId}`;
        const existing = localStorage.getItem(key);
        const data = existing ? JSON.parse(existing) : {};
        data[fieldName] = value;
        data._lastUpdated = new Date().toISOString();
        localStorage.setItem(key, JSON.stringify(data));
    }
    
    /**
     * Update profile UI with synced data
     */
    _updateProfileUI(data) {
        // Handle profile data from Firestore
        const profile = data.profile || data;
        
        if (profile.firstName) {
            document.querySelectorAll('.user-first-name').forEach(el => {
                el.textContent = profile.firstName;
            });
        }
        
        if (profile.lastName) {
            document.querySelectorAll('.user-last-name').forEach(el => {
                el.textContent = profile.lastName;
            });
        }
        
        if (profile.displayName) {
            document.querySelectorAll('.user-name, .nav-user-name').forEach(el => {
                el.textContent = profile.displayName;
            });
        }
        
        if (profile.email) {
            document.querySelectorAll('.user-email').forEach(el => {
                el.textContent = profile.email;
            });
        }
        
        console.log('Profile UI updated');
    }
    
    /**
     * Update forms UI with synced data
     */
    _updateFormsUI(data) {
        // Handle forms data from Firestore
        const formsData = data.forms || data;
        
        // Map Firestore data to form fields
        const fieldMappings = {
            'lastName': 'lastName',
            'firstName': 'firstName',
            'middleName': 'middleName',
            'dob': 'dob',
            'birthCountry': 'birthCountry',
            'nationality': 'nationality',
            'aNumber': 'aNumber',
            'eligibilityBasis': 'eligibilityBasis',
            'currentAddress': 'currentAddress',
            'currentCity': 'currentCity',
            'currentState': 'currentState',
            'currentZip': 'currentZip'
        };
        
        Object.entries(fieldMappings).forEach(([firestoreField, elementId]) => {
            if (formsData[firestoreField]) {
                const el = document.getElementById(elementId);
                if (el && document.activeElement !== el) {
                    el.value = formsData[firestoreField];
                }
            }
        });
        
        // Update progress if available
        const progressData = data.progress || formsData._progress;
        if (progressData) {
            const progressEl = document.getElementById('formProgress');
            if (progressEl) {
                const percentage = progressData.overallPercentage || progressData;
                progressEl.textContent = `Progress: ${percentage}%`;
            }
            
            // Update progress bar if exists
            const progressBar = document.getElementById('progress-fill');
            if (progressBar) {
                const percentage = progressData.overallPercentage || progressData;
                progressBar.style.width = `${percentage}%`;
            }
        }
        
        console.log('Forms UI updated');
    }
    
    /**
     * Update documents UI with synced data
     */
    _updateDocumentsUI(data) {
        const documentsData = data.documents || data;
        
        if (documentsData && Array.isArray(documentsData)) {
            // Update document list if it exists
            const docList = document.getElementById('documentList');
            if (docList) {
                this._refreshDocumentList(documentsData);
            }
            
            // Update stats
            const uploaded = documentsData.filter(d => d.status === 'uploaded').length;
            const total = documentsData.length;
            const uploadedEl = document.getElementById('uploadedDocs');
            const totalEl = document.getElementById('totalDocs');
            
            if (uploadedEl) uploadedEl.textContent = uploaded;
            if (totalEl) totalEl.textContent = total;
        }
        
        console.log('Documents UI updated');
    }
    
    /**
     * Apply synced settings
     */
    _applySettings(settings) {
        // Apply theme
        if (settings.theme) {
            document.documentElement.setAttribute('data-theme', settings.theme);
            const themeIcon = document.getElementById('themeIcon');
            if (themeIcon) {
                themeIcon.className = settings.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
            localStorage.setItem('theme', settings.theme);
        }
        
        // Apply speech setting
        if (settings.speechEnabled !== undefined) {
            window.speechEnabled = settings.speechEnabled;
            localStorage.setItem('speechEnabled', settings.speechEnabled);
        }
        
        // Apply language setting
        if (settings.language) {
            localStorage.setItem('language', settings.language);
        }
        
        // Apply notification setting
        if (settings.notifications !== undefined) {
            localStorage.setItem('notifications', settings.notifications);
        }
        
        console.log('Settings applied');
    }
    
    /**
     * Refresh document list in UI
     */
    _refreshDocumentList(documents) {
        const docList = document.getElementById('documentList');
        if (!docList) return;
        
        // This would call the populateDocuments function from forms page
        if (typeof window.refreshDocumentsUI === 'function') {
            window.refreshDocumentsUI(documents);
        }
    }
    
    /**
     * Notify sync status listeners
     */
    _notifySyncListeners(status, message) {
        this.syncStatus = status;
        this.syncListeners.forEach(listener => {
            if (typeof listener === 'function') {
                listener(status, message);
            }
        });
        
        // Update UI if it exists
        this._updateSyncStatusUI(status, message);
    }
    
    /**
     * Update sync status UI
     */
    _updateSyncStatusUI(status, message) {
        const statusEl = document.getElementById('sync-status');
        const statusIcon = document.getElementById('sync-status-icon');
        const statusText = document.getElementById('sync-status-text');
        
        if (!statusEl && !statusIcon && !statusText) return;
        
        const icons = {
            'synced': '<span class="sync-icon synced">✓</span>',
            'syncing': '<span class="sync-icon syncing">↻</span>',
            'offline': '<span class="sync-icon offline">☁</span>',
            'error': '<span class="sync-icon error">!</span>'
        };
        
        if (statusIcon) statusIcon.innerHTML = icons[status] || icons['synced'];
        if (statusText) statusText.textContent = message || status;
        if (statusEl) statusEl.title = message || status;
    }
    
    /**
     * Add sync status listener
     */
    addSyncListener(callback) {
        this.syncListeners.push(callback);
    }
    
    /**
     * Remove sync status listener
     */
    removeSyncListener(callback) {
        this.syncListeners = this.syncListeners.filter(l => l !== callback);
    }
    
    /**
     * Get current sync status
     */
    getSyncStatus() {
        return {
            status: this.syncStatus,
            userId: this.userId,
            pendingWrites: this.pendingWrites.size
        };
    }
    
    /**
     * Force sync all pending data
     */
    async forceSync() {
        if (!this.userId) return false;
        
        this._notifySyncListeners('syncing', 'Syncing...');
        
        // Process pending localStorage writes
        const localKeys = Object.keys(localStorage).filter(k => 
            k.startsWith('forms_') || k.startsWith('documents_') || k.startsWith('profile_') ||
            k === 'formData' || k === 'progressData' || k === 'settings'
        );
        
        for (const key of localKeys) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                
                // Determine what type of data this is
                if (key === 'formData') {
                    await FirebaseCore.updateDocument(`users/${this.userId}`, { forms: data });
                } else if (key === 'progressData') {
                    await FirebaseCore.updateDocument(`users/${this.userId}`, { progress: data });
                } else if (key === 'settings') {
                    await FirebaseCore.updateDocument(`users/${this.userId}`, { settings: data });
                }
                
                // Remove from localStorage after successful sync
                localStorage.removeItem(key);
            } catch (error) {
                console.error('Error syncing', key, ':', error);
            }
        }
        
        this._notifySyncListeners('synced', 'All changes saved');
        return true;
    }
    
    /**
     * Get user data from Firestore
     */
    async getUserData() {
        if (!this.userId) return null;
        
        try {
            const doc = await FirebaseCore.getDocument(`users/${this.userId}`);
            if (doc.exists && doc.data) {
                return doc.data;
            }
            return null;
        } catch (error) {
            console.error('Error getting user data:', error);
            return null;
        }
    }
}

// Initialize data sync when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dataSync = new DataSync();
});
