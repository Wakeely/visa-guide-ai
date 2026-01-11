/**
 * Visa Guide AI - Authentication Manager
 * Handles user signup, login, password reset, and session management
 * Uses real Firebase Authentication with robust initialization
 */

class AuthManager {
    constructor() {
        this.auth = null;
        this.initialized = false;
        this.initPromise = null;
    }

    /**
     * Initialize the auth manager - waits for Firebase to be ready
     */
    async ensureInitialized() {
        // If already initialized, return immediately
        if (this.initialized && this.auth) {
            return;
        }

        // If initialization is in progress, wait for it
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        // Start initialization
        this.initPromise = this._doInitialize();
        await this.initPromise;
    }

    /**
     * Do the actual initialization
     */
    async _doInitialize() {
        // Wait for FirebaseCore to be available
        let attempts = 0;
        while (typeof FirebaseCore === 'undefined' && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof FirebaseCore === 'undefined') {
            console.error('FirebaseCore not found. Make sure firebase-config.js is loaded.');
            throw new Error('FirebaseCore not found');
        }

        // Initialize Firebase if not already done
        if (!FirebaseCore.isInitialized()) {
            FirebaseCore.initialize(firebaseConfig);
        }

        this.auth = FirebaseCore.getAuth();
        this.initialized = true;

        // Initialize auth state listener
        this._initAuthListener();

        console.log('AuthManager initialized with real Firebase Auth');
    }

    /**
     * Initialize authentication state listener
     */
    _initAuthListener() {
        if (!this.auth || !this.auth.onAuthStateChanged) return;

        this.auth.onAuthStateChanged((user) => {
            if (user) {
                console.log('User is signed in:', user.email);
                this._handleSignedIn(user);
            } else {
                console.log('User is signed out');
                this._handleSignedOut();
            }
        });
    }

    /**
     * Handle user signed in state
     */
    _handleSignedIn(user) {
        // Update UI to show logged in state
        this._updateAuthUI(true, user);

        // Store session
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userEmail', user.email);
        localStorage.setItem('userId', user.uid);
        
        // Store user data for persistence
        try {
            localStorage.setItem('firebaseUser', JSON.stringify({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            }));
        } catch (e) {
            console.warn('Could not store user data:', e);
        }

        // Sync local data to cloud if exists
        this._migrateLocalData(user.uid);
    }

    /**
     * Handle user signed out state
     */
    _handleSignedOut() {
        // Update UI to show logged out state
        this._updateAuthUI(false, null);

        // Clear session
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userId');
        localStorage.removeItem('firebaseUser');

        // Redirect to auth page if on protected page
        const currentPage = window.location.pathname.split('/').pop();
        const protectedPages = ['visa-guide-dashboard.html', 'visa-guide-forms.html', 'visa-guide-chatbot.html', 'visa-guide-forms-with-review-v2.html'];

        if (protectedPages.includes(currentPage)) {
            window.location.href = 'visa-guide-auth.html';
        }
    }

    /**
     * Update UI based on auth state
     */
    _updateAuthUI(isLoggedIn, user) {
        // Update nav elements if they exist
        const userNameElements = document.querySelectorAll('.user-name, .nav-user-name');
        userNameElements.forEach(el => {
            if (isLoggedIn && user) {
                el.textContent = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
            }
        });

        // Show/hide login/logout buttons
        const loginBtns = document.querySelectorAll('.login-btn, .nav-login-btn');
        const logoutBtns = document.querySelectorAll('.logout-btn, .nav-logout-btn');

        loginBtns.forEach(el => el.style.display = isLoggedIn ? 'none' : 'block');
        logoutBtns.forEach(el => el.style.display = isLoggedIn ? 'block' : 'none');
    }

    /**
     * Sign in with email and password
     */
    async signIn(email, password) {
        // Ensure Firebase is initialized before attempting login
        await this.ensureInitialized();

        this._clearErrors();
        this._setLoading(true);

        try {
            if (!email || !password) {
                throw { code: 'auth/empty-fields', message: 'Please enter both email and password' };
            }

            if (!this._isValidEmail(email)) {
                throw { code: 'auth/invalid-email', message: 'Please enter a valid email address' };
            }

            console.log('Attempting to sign in:', email);
            const result = await FirebaseCore.signIn(email, password);
            console.log('Sign in successful:', result.user.email);
            
            showToast('Welcome back! Redirecting...');
            return { success: true, user: result.user };

        } catch (error) {
            console.error('Sign in error:', error);
            const errorMessage = this._getAuthErrorMessage(error.code || error.message);
            this._showError(errorMessage);
            return { success: false, error: error };
        } finally {
            this._setLoading(false);
        }
    }

    /**
     * Sign up with email and password
     */
    async signUp(email, password, confirmPassword, firstName = '') {
        // Ensure Firebase is initialized before attempting signup
        await this.ensureInitialized();

        this._clearErrors();
        this._setLoading(true);

        try {
            // Validation
            if (!email || !password || !confirmPassword) {
                throw { code: 'auth/empty-fields', message: 'Please fill in all required fields' };
            }

            if (!this._isValidEmail(email)) {
                throw { code: 'auth/invalid-email', message: 'Please enter a valid email address' };
            }

            if (password.length < 6) {
                throw { code: 'auth/weak-password', 'Password must be at least 6 characters' };
            }

            if (password !== confirmPassword) {
                throw { code: 'auth/passwords-mismatch', message: 'Passwords do not match' };
            }

            console.log('Creating new account:', email);
            // Create user account (Firebase Auth)
            const result = await FirebaseCore.signUp(email, password);
            console.log('Firebase Auth account created successfully:', result.user.email);

            // Try to create user profile in Firestore (best effort)
            try {
                await this._createUserProfile(result.user.uid, {
                    email: email,
                    firstName: firstName || email.split('@')[0],
                    displayName: firstName || email.split('@')[0]
                });
                console.log('User profile created in Firestore');
            } catch (profileError) {
                // Profile creation failed, but account was created - that's OK!
                console.warn('Could not create user profile in Firestore (will create on first login):', profileError.message);
            }

            return { success: true, user: result.user };

        } catch (error) {
            console.error('Sign up error:', error);
            const errorMessage = this._getAuthErrorMessage(error.code || error.message);
            this._showError(errorMessage);
            return { success: false, error: error };
        } finally {
            this._setLoading(false);
        }
    }

    /**
     * Sign out current user
     */
    async signOut() {
        // Ensure Firebase is initialized before attempting sign out
        await this.ensureInitialized();

        try {
            await FirebaseCore.signOut();
            showToast('You have been signed out');
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            showToast('Error signing out: ' + error.message);
            return { success: false, error: error };
        }
    }

    /**
     * Send password reset email
     */
    async resetPassword(email) {
        // Ensure Firebase is initialized
        await this.ensureInitialized();

        this._clearErrors();

        try {
            if (!email || !this._isValidEmail(email)) {
                throw { code: 'auth/invalid-email', message: 'Please enter a valid email address' };
            }

            await FirebaseCore.resetPassword(email);
            showToast('Password reset email sent! Check your inbox.');
            return { success: true };

        } catch (error) {
            console.error('Reset password error:', error);
            const errorMessage = this._getAuthErrorMessage(error.code || error.message);
            this._showError(errorMessage);
            return { success: false, error: error };
        }
    }

    /**
     * Create user profile in Firestore
     */
    async _createUserProfile(uid, data) {
        try {
            const userData = {
                profile: data,
                progress: {
                    overallPercentage: 0,
                    currentStep: 0,
                    completedSteps: []
                },
                settings: {
                    theme: 'light',
                    language: 'en',
                    notifications: true,
                    speechEnabled: true
                },
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            };

            // Use updateDocument to create/update user profile at correct path
            await FirebaseCore.updateDocument(`users/${uid}`, userData);
            console.log('User profile created successfully at users/' + uid);
        } catch (error) {
            console.warn('Could not create user profile in Firestore:', error.message);
            // This is OK - profile can be created later
        }
    }

    /**
     * Migrate localStorage data to cloud on first login
     */
    async _migrateLocalData(userId) {
        try {
            // Check for local data
            const localData = {
                userData: localStorage.getItem('userData'),
                formData: localStorage.getItem('n400FormData'),
                documents: localStorage.getItem('documentsData'),
                theme: localStorage.getItem('theme'),
                speechEnabled: localStorage.getItem('speechEnabled')
            };

            // If local data exists, migrate it
            if (localData.userData || localData.formData || localData.documents) {
                const migrationData = {};

                if (localData.userData) {
                    migrationData.profile = JSON.parse(localData.userData);
                }

                if (localData.formData) {
                    migrationData.forms = { n400: JSON.parse(localData.formData) };
                }

                if (localData.documents) {
                    migrationData.documents = JSON.parse(localData.documents);
                }

                if (localData.theme) {
                    migrationData.settings = { theme: localData.theme };
                }

                if (localData.speechEnabled !== null) {
                    migrationData.settings = migrationData.settings || {};
                    migrationData.settings.speechEnabled = localData.speechEnabled === 'true';
                }

                migrationData.lastUpdated = new Date().toISOString();

                // Save to Firestore using updateDocument
                await FirebaseCore.updateDocument(`users/${userId}`, migrationData);

                console.log('Local data migrated to cloud successfully');
                showToast('Your data has been synced to the cloud!');
            }
        } catch (error) {
            console.error('Error migrating local data:', error);
        }
    }

    /**
     * Get user profile from Firestore
     */
    async getUserProfile(uid) {
        try {
            const doc = await FirebaseCore.getDocument(`users/${uid}`);
            if (doc.exists && doc.data) {
                return doc.data;
            }
            return null;
        } catch (error) {
            console.error('Error getting user profile:', error);
            return null;
        }
    }

    /**
     * Update user profile in Firestore
     */
    async updateUserProfile(uid, data) {
        try {
            await FirebaseCore.updateDocument(`users/${uid}`, data);
            console.log('User profile updated successfully');
            return { success: true };
        } catch (error) {
            console.error('Error updating user profile:', error);
            return { success: false, error: error };
        }
    }

    /**
     * Validate email format
     */
    _isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    /**
     * Get user-friendly error message
     */
    _getAuthErrorMessage(errorCode) {
        const errorMessages = {
            'auth/email-already-in-use': 'An account with this email already exists',
            'auth/invalid-email': 'Please enter a valid email address',
            'auth/operation-not-allowed': 'This operation is not allowed. Please contact support.',
            'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
            'auth/user-disabled': 'This account has been disabled. Please contact support.',
            'auth/user-not-found': 'No account found with this email',
            'auth/wrong-password': 'Incorrect password. Please try again.',
            'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
            'auth/network-request-failed': 'Network error. Please check your connection.',
            'auth/popup-closed-by-user': 'Sign-in popup was closed',
            'auth/cancelled-popup-request': 'Sign-in was cancelled',
            'auth/empty-fields': 'Please fill in all required fields',
            'auth/passwords-mismatch': 'Passwords do not match',
            'auth/expired-action-code': 'This reset link has expired',
            'auth/invalid-action-code': 'This reset link is invalid',
            'auth/user-token-expired': 'Session expired. Please sign in again.',
            'auth/invalid-credential': 'Invalid email or password. Please check your credentials.'
        };

        return errorMessages[errorCode] || errorCode || 'An error occurred. Please try again.';
    }

    /**
     * Show error message
     */
    _showError(message) {
        const errorEl = document.getElementById('auth-error') || document.getElementById('error-message');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        } else {
            showToast(message);
        }
    }

    /**
     * Clear error messages
     */
    _clearErrors() {
        const errorEl = document.getElementById('auth-error') || document.getElementById('error-message');
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
    }

    /**
     * Set loading state
     */
    _setLoading(isLoading) {
        const submitBtn = document.querySelector('button[type="submit"]');
        const loadingEl = document.getElementById('auth-loading');

        if (submitBtn) {
            submitBtn.disabled = isLoading;
            if (isLoading) {
                submitBtn.dataset.originalText = submitBtn.textContent;
                submitBtn.innerHTML = '<span class="loading-spinner"></span> Please wait...';
            } else {
                submitBtn.textContent = submitBtn.dataset.originalText || submitBtn.textContent;
            }
        }

        if (loadingEl) {
            loadingEl.style.display = isLoading ? 'block' : 'none';
        }
    }

    /**
     * Check if user is currently logged in
     */
    isLoggedIn() {
        return localStorage.getItem('isLoggedIn') === 'true';
    }

    /**
     * Get current user
     */
    getCurrentUser() {
        const userData = localStorage.getItem('firebaseUser');
        return userData ? JSON.parse(userData) : null;
    }

    /**
     * Get user ID
     */
    getUserId() {
        return localStorage.getItem('userId');
    }

    /**
     * Get user email
     */
    getUserEmail() {
        return localStorage.getItem('userEmail');
    }
}

// Initialize auth manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.authManager = new AuthManager();
});
