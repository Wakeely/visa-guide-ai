/**
 * Visa Guide AI - Document Manager Module
 * Handles real file storage using Firebase Storage and Firestore
 */

// Document Manager Configuration
const DocumentManager = {
    // Maximum file size: 5MB
    MAX_FILE_SIZE: 5 * 1024 * 1024,
    
    // Allowed file types
    ALLOWED_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
    
    // Document types and their display names
    DOCUMENT_TYPES: {
        'birth_certificate': 'Birth Certificate',
        'passport': 'Passport',
        'i94': 'I-94 Arrival/Departure',
        'i797': 'I-797 Approval Notice',
        'police_certificate': 'Police Certificates',
        'tax_returns': 'Tax Returns (Last 3 years)',
        'marriage_certificate': 'Marriage Certificate',
        'medical_exam': 'Medical Examination (I-693)'
    },

    /**
     * Initialize the Document Manager
     * Must be called after Firebase is initialized
     */
    init: function() {
        if (!window.FirebaseCore || !window.FirebaseCore.isInitialized()) {
            console.error('Document Manager: Firebase not initialized');
            return false;
        }
        console.log('Document Manager initialized successfully');
        return true;
    },

    /**
     * Validate file before upload
     * @param {File} file - The file to validate
     * @returns {Object} - { valid: boolean, error?: string }
     */
    validateFile: function(file) {
        if (!file) {
            return { valid: false, error: 'No file selected' };
        }

        // Check file size
        if (file.size > this.MAX_FILE_SIZE) {
            return { 
                valid: false, 
                error: `File too large. Maximum size is 5MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB` 
            };
        }

        // Check file type
        if (!this.ALLOWED_TYPES.includes(file.type)) {
            return { 
                valid: false, 
                error: 'Invalid file type. Only PDF, JPG, and PNG files are allowed.' 
            };
        }

        return { valid: true };
    },

    /**
     * Upload a document to Firebase Storage
     * @param {File} file - The file to upload
     * @param {string} docType - The document type key
     * @param {function} onProgress - Progress callback
     * @returns {Promise} - Resolves with document data
     */
    uploadDocument: async function(file, docType, onProgress = null) {
        try {
            // Validate file
            const validation = this.validateFile(file);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Get Firebase instances
            const storage = window.FirebaseCore.getStorage();
            const auth = window.FirebaseCore.getAuth();
            const db = window.FirebaseCore.getDb();

            // Check authentication
            const user = auth.currentUser;
            if (!user) {
                throw new Error('You must be logged in to upload documents');
            }

            // Create storage reference
            const timestamp = Date.now();
            const fileExtension = file.name.split('.').pop();
            const storagePath = `users/${user.uid}/documents/${docType}/${timestamp}_${file.name}`;
            const storageRef = storage.ref(storagePath);

            // Upload file with progress tracking
            const uploadTask = storageRef.put(file);

            return new Promise((resolve, reject) => {
                uploadTask.on(
                    'state_changed',
                    (snapshot) => {
                        // Progress tracking
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        console.log(`Upload progress: ${progress.toFixed(2)}%`);
                        
                        if (onProgress) {
                            onProgress(progress);
                        }
                    },
                    (error) => {
                        console.error('Upload error:', error);
                        reject(new Error('Upload failed: ' + error.message));
                    },
                    async () => {
                        try {
                            // Get download URL
                            const downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();

                            // Save metadata to Firestore
                            const docData = {
                                docType: docType,
                                fileName: file.name,
                                fileUrl: downloadUrl,
                                storagePath: storagePath,
                                mimeType: file.type,
                                fileSize: file.size,
                                status: 'uploaded',
                                uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            };

                            // Store in user's documents subcollection
                            await db.collection('users')
                                .doc(user.uid)
                                .collection('documents')
                                .doc(docType)
                                .set(docData, { merge: true });

                            console.log('Document uploaded successfully:', docType);
                            resolve({
                                success: true,
                                data: docData,
                                message: 'Document uploaded successfully!'
                            });
                        } catch (error) {
                            console.error('Error saving document metadata:', error);
                            reject(new Error('Failed to save document information'));
                        }
                    }
                );
            });
        } catch (error) {
            console.error('Upload document error:', error);
            throw error;
        }
    },

    /**
     * Get a specific document for a user
     * @param {string} docType - The document type key
     * @returns {Promise} - Resolves with document data or null
     */
    getDocument: async function(docType) {
        try {
            const auth = window.FirebaseCore.getAuth();
            const db = window.FirebaseCore.getDb();

            const user = auth.currentUser;
            if (!user) {
                throw new Error('You must be logged in to view documents');
            }

            const docRef = db.collection('users')
                .doc(user.uid)
                .collection('documents')
                .doc(docType);

            const docSnap = await docRef.get();

            if (docSnap.exists) {
                return {
                    id: docSnap.id,
                    ...docSnap.data()
                };
            }

            return null;
        } catch (error) {
            console.error('Get document error:', error);
            throw error;
        }
    },

    /**
     * Get all documents for the current user
     * @returns {Promise} - Resolves with array of document data
     */
    getAllDocuments: async function() {
        try {
            const auth = window.FirebaseCore.getAuth();
            const db = window.FirebaseCore.getDb();

            const user = auth.currentUser;
            if (!user) {
                throw new Error('You must be logged in to view documents');
            }

            const documentsRef = db.collection('users')
                .doc(user.uid)
                .collection('documents');

            const snapshot = await documentsRef.get();
            const documents = [];

            snapshot.forEach((doc) => {
                documents.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            return documents;
        } catch (error) {
            console.error('Get all documents error:', error);
            throw error;
        }
    },

    /**
     * Delete a document from Storage and Firestore
     * @param {string} docType - The document type key
     * @returns {Promise}
     */
    deleteDocument: async function(docType) {
        try {
            const auth = window.FirebaseCore.getAuth();
            const storage = window.FirebaseCore.getStorage();
            const db = window.FirebaseCore.getDb();

            const user = auth.currentUser;
            if (!user) {
                throw new Error('You must be logged in to delete documents');
            }

            // Get document metadata first
            const docData = await this.getDocument(docType);
            
            if (docData && docData.storagePath) {
                // Delete from Storage
                const storageRef = storage.ref(docData.storagePath);
                await storageRef.delete();
            }

            // Delete from Firestore
            await db.collection('users')
                .doc(user.uid)
                .collection('documents')
                .doc(docType)
                .delete();

            console.log('Document deleted successfully:', docType);
            return {
                success: true,
                message: 'Document deleted successfully'
            };
        } catch (error) {
            console.error('Delete document error:', error);
            throw error;
        }
    },

    /**
     * View a document - opens in new tab
     * @param {string} docType - The document type key
     */
    viewDocument: async function(docType) {
        try {
            const docData = await this.getDocument(docType);
            
            if (!docData || !docData.fileUrl) {
                throw new Error('Document not found');
            }

            // Open in new tab
            window.open(docData.fileUrl, '_blank');
            
            return {
                success: true,
                message: 'Opening document...'
            };
        } catch (error) {
            console.error('View document error:', error);
            throw error;
        }
    },

    /**
     * Download a document
     * @param {string} docType - The document type key
     */
    downloadDocument: async function(docType) {
        try {
            const docData = await this.getDocument(docType);
            
            if (!docData || !docData.fileUrl) {
                throw new Error('Document not found');
            }

            // Create temporary anchor element for download
            const link = document.createElement('a');
            link.href = docData.fileUrl;
            link.download = docData.fileName || `${docType}_document`;
            link.target = '_blank';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            return {
                success: true,
                message: 'Download started...'
            };
        } catch (error) {
            console.error('Download document error:', error);
            throw error;
        }
    },

    /**
     * Get document display name
     * @param {string} docType - The document type key
     * @returns {string}
     */
    getDocumentName: function(docType) {
        return this.DOCUMENT_TYPES[docType] || docType;
    },

    /**
     * Format file size for display
     * @param {number} bytes - File size in bytes
     * @returns {string}
     */
    formatFileSize: function(bytes) {
        if (!bytes) return 'Unknown';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    /**
     * Format date for display
     * @param {Object} timestamp - Firestore timestamp
     * @returns {string}
     */
    formatDate: function(timestamp) {
        if (!timestamp) return 'Unknown';
        
        let date;
        if (timestamp.toDate) {
            // Firestore Timestamp
            date = timestamp.toDate();
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else {
            date = new Date(timestamp);
        }
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
};

// Export to global scope
window.DocumentManager = DocumentManager;

// Console log for verification
console.log('Document Manager module loaded successfully');
