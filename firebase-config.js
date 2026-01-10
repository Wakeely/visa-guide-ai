/**
 * Visa Guide AI - Firebase Configuration & Core Module
 * Handles Firebase initialization, authentication, and cloud sync
 */

// Firebase Configuration - Your credentials from Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyC9W6Px0lj73kUoE6BRBmSYOmyjJhjqvXI",
    authDomain: "visa-guide-ai.firebaseapp.com",
    projectId: "visa-guide-ai",
    storageBucket: "visa-guide-ai.firebasestorage.app",
    messagingSenderId: "720518812984",
    appId: "1:720518812984:web:a29e52e239030f1a569dcd",
    measurementId: "G-5S4V5SBCHB"
};

// Firebase instances (will be initialized)
let app = null;
let auth = null;
let db = null;
let storage = null;
let isFirebaseInitialized = false;

/**
 * Initialize Firebase - Call this to connect to Firebase
 */
function initializeFirebase(config) {
    if (isFirebaseInitialized) {
        console.warn('Firebase already initialized');
        return { app, auth, db, storage };
    }
    
    try {
        // Initialize Firebase with the provided config
        app = firebase.initializeApp(config);
        
        // Initialize Firebase services
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();
        
        // Enable persistence for offline support (optional - may not work in all browsers)
        // db.enablePersistence({ experimentalTabSynchronization: true })
        //   .catch((err) => {
        //       if (err.code == 'failed-precondition') {
        //           console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time');
        //       } else if (err.code == 'unsupported-browser') {
        //           console.warn('Persistence is not supported in this browser');
        //       }
        //   });
        
        isFirebaseInitialized = true;
        console.log('Firebase initialized successfully with real Firebase SDK!');
        console.log('Connected to project:', config.projectId);
        
        return { app, auth, db, storage };
        
    } catch (error) {
        console.error('Error initializing Firebase:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        throw error;
    }
}

/**
 * Get the current Firebase Auth instance
 */
function getFirebaseAuth() {
    if (!isFirebaseInitialized || !auth) {
        throw new Error('Firebase not initialized. Call initializeFirebase() first.');
    }
    return auth;
}

/**
 * Get the current Firestore instance
 */
function getFirebaseDb() {
    if (!isFirebaseInitialized || !db) {
        throw new Error('Firebase not initialized. Call initializeFirebase() first.');
    }
    return db;
}

/**
 * Get the current Storage instance
 */
function getFirebaseStorage() {
    if (!isFirebaseInitialized || !storage) {
        throw new Error('Firebase not initialized. Call initializeFirebase() first.');
    }
    return storage;
}

/**
 * Check if Firebase is initialized
 */
function isFirebaseReady() {
    return isFirebaseInitialized;
}

/**
 * Get the current user
 */
function getCurrentUser() {
    if (!isFirebaseInitialized || !auth) {
        return null;
    }
    return auth.currentUser;
}

/**
 * Sign in with email and password
 */
async function signInWithEmail(email, password) {
    const authInstance = getFirebaseAuth();
    return await authInstance.signInWithEmailAndPassword(email, password);
}

/**
 * Create a new account with email and password
 */
async function createAccount(email, password) {
    const authInstance = getFirebaseAuth();
    return await authInstance.createUserWithEmailAndPassword(email, password);
}

/**
 * Sign out the current user
 */
async function signOutUser() {
    const authInstance = getFirebaseAuth();
    return await authInstance.signOut();
}

/**
 * Send password reset email
 */
async function resetPassword(email) {
    const authInstance = getFirebaseAuth();
    return await authInstance.sendPasswordResetEmail(email);
}

/**
 * Listen for authentication state changes
 */
function onAuthStateChanged(callback) {
    const authInstance = getFirebaseAuth();
    return authInstance.onAuthStateChanged(callback);
}

/**
 * Add a document to a Firestore collection
 */
async function addDocument(collectionPath, data) {
    const dbInstance = getFirebaseDb();
    return await dbInstance.collection(collectionPath).add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Get a document from Firestore
 */
async function getDocument(documentPath) {
    const dbInstance = getFirebaseDb();
    const docRef = dbInstance.doc(documentPath);
    const docSnap = await docRef.get();
    return { exists: docSnap.exists, data: docSnap.data(), id: docSnap.id };
}

/**
 * Get all documents from a collection
 */
async function getCollection(collectionPath) {
    const dbInstance = getFirebaseDb();
    const snapshot = await dbInstance.collection(collectionPath).get();
    const docs = [];
    snapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
    });
    return docs;
}

/**
 * Update a document in Firestore
 */
async function updateDocument(documentPath, data) {
    const dbInstance = getFirebaseDb();
    const docRef = dbInstance.doc(documentPath);
    return await docRef.update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Delete a document from Firestore
 */
async function deleteDocument(documentPath) {
    const dbInstance = getFirebaseDb();
    const docRef = dbInstance.doc(documentPath);
    return await docRef.delete();
}

/**
 * Query a collection with conditions
 */
async function queryCollection(collectionPath, conditions) {
    const dbInstance = getFirebaseDb();
    let collectionRef = dbInstance.collection(collectionPath);
    
    // Apply where conditions
    conditions.forEach(condition => {
        collectionRef = collectionRef.where(condition.field, condition.operator, condition.value);
    });
    
    const snapshot = await collectionRef.get();
    const docs = [];
    snapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
    });
    return docs;
}

// Export functions globally for use in other scripts
window.FirebaseCore = {
    initialize: initializeFirebase,
    getAuth: getFirebaseAuth,
    getDb: getFirebaseDb,
    getStorage: getFirebaseStorage,
    isInitialized: isFirebaseReady,
    getCurrentUser: getCurrentUser,
    // Auth functions
    signIn: signInWithEmail,
    signUp: createAccount,
    signOut: signOutUser,
    resetPassword: resetPassword,
    onAuthStateChanged: onAuthStateChanged,
    // Firestore functions
    addDocument: addDocument,
    getDocument: getDocument,
    getCollection: getCollection,
    updateDocument: updateDocument,
    deleteDocument: deleteDocument,
    queryCollection: queryCollection
};
