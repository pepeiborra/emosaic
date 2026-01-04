export const en = {
  // Common
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    save: 'Save',
    create: 'Create',
    edit: 'Edit',
    back: 'Back',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    yes: 'Yes',
    no: 'No',
    main: 'Main',
    remove: 'Remove',
    enable: 'Enable',
    disable: 'Disable',
    deleting: 'Deleting...',
  },

  // Navigation
  nav: {
    dashboard: 'Dashboard',
    createMosaic: 'Create Mosaic',
    uploadImages: 'Upload Images',
    users: 'Users',
    errorLogs: 'Error Logs',
    signOut: 'Sign out',
    openSidebar: 'Open sidebar',
    appTitle: 'Casa del manco Admin',
  },

  // Login page
  login: {
    title: 'Casa del manco Admin',
    subtitle: 'Sign in to manage your mosaics',
    emailLabel: 'Email address',
    emailPlaceholder: 'Email address',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Password',
    forgotPassword: 'Forgot your password?',
    signIn: 'Sign in',
    signingIn: 'Signing in...',
    noAccount: "Don't have an account?",
    requestAccess: 'Request access',

    // New password
    setNewPassword: 'Set New Password',
    newPasswordRequired: 'Your account requires a new password',
    newPassword: 'New Password',
    confirmPassword: 'Confirm Password',
    passwordsDoNotMatch: 'Passwords do not match',
    passwordRequirements: 'Password must be at least 12 characters with uppercase, lowercase, numbers, and symbols.',
    setPassword: 'Set Password',
    settingPassword: 'Setting password...',

    // Forgot password
    resetPassword: 'Reset Password',
    enterEmailForReset: 'Enter your email to receive a verification code',
    sendResetCode: 'Send Reset Code',
    sending: 'Sending...',
    backToSignIn: 'Back to sign in',
    verificationCodeSent: 'A verification code has been sent to your email',

    // Reset password
    enterNewPassword: 'Enter New Password',
    checkEmailForCode: 'Check your email for the verification code',
    verificationCode: 'Verification Code',
    enterCodeFromEmail: 'Enter code from email',
    resetting: 'Resetting...',
    passwordResetSuccess: 'Password reset successfully. Please sign in.',
  },

  // Register page
  register: {
    title: 'Request Access',
    subtitle: 'Fill out the form below to request access to the admin panel',
    nameLabel: 'Full Name',
    namePlaceholder: 'Your name',
    emailLabel: 'Email Address',
    emailPlaceholder: 'your@email.com',
    captchaLabel: 'Security Question',
    captchaPlaceholder: 'Enter the answer',
    refreshCaptcha: 'Get new question',
    submit: 'Submit Request',
    submitting: 'Submitting...',
    alreadyHaveAccount: 'Already have an account? Sign in',
    backToLogin: 'Back to login',
    successTitle: 'Request Submitted',
    successMessage: 'Your access request has been submitted. An administrator will review it and you will receive an email when your account is approved.',
    captchaLoadError: 'Failed to load security question. Please try again.',
    submitError: 'Failed to submit registration. Please try again.',
  },

  // Dashboard
  dashboard: {
    title: 'Mosaics',
    subtitle: 'Manage your photo mosaics',
    createNew: 'Create New',
    noMosaics: 'No mosaics',
    getStarted: 'Get started by creating a new mosaic.',
    createMosaic: 'Create Mosaic',
    failedToLoad: 'Failed to load mosaics',
    unknownError: 'Unknown error',
  },

  // Status badges
  status: {
    pending: 'pending',
    processing: 'processing',
    completed: 'completed',
    failed: 'failed',
    running: 'running',
    succeeded: 'succeeded',
    cancelled: 'cancelled',
    submitted: 'submitted',
  },

  // Create Mosaic page
  createMosaic: {
    title: 'Create Mosaic',
    subtitle: 'Upload a source image and configure mosaic generation settings.',
    sourceImage: 'Source Image',
    clickOrDrag: 'Click or drag and drop to upload',
    fileLimit: 'PNG, JPG up to 20MB',
    titleLabel: 'Title (optional)',
    titlePlaceholder: 'My Mosaic',

    // Tile settings
    tileSize: 'Tile Size',
    tileSizeHelp: 'Smaller tiles = more detail but larger output',
    tileSizeDivisible: 'must be divisible by {dim} for mode {mode}',

    // Downsample
    downsample: 'Downsample Factor',
    noDownsampling: 'no downsampling',
    resolution: '1/{factor} resolution',
    downsampleHelp: 'Higher values reduce output size and processing time',

    // Mode
    matchingMode: 'Matching Mode',
    singleColorMatch: '1x1, single color match',
    gridMatching: '{dim}x{dim} grid matching',
    bestQuality: 'best quality',
    randomIgnoreSource: 'Random (ignore source)',
    modeHelp: 'Higher values analyze more segments per tile for better matching',

    // Tint
    tintOpacity: 'Tint Opacity',
    tintHelp: 'Higher values blend the source image more visibly',

    // Checkboxes
    noRepeat: 'No repeat tiles (uses Hungarian algorithm)',
    cropTiles: 'Crop tiles to square (instead of resize)',

    // Tile folders
    tileFolders: 'Tile Folders',
    includedOf: 'of',
    included: 'included',
    loadingFolders: 'Loading folders...',
    noFolders: 'No folders found in tiles directory',
    uncheckFolders: 'Uncheck folders to exclude them from mosaic generation',

    // Preview stats
    mosaicPreview: 'Mosaic Preview',
    sourceImageLabel: 'Source Image',
    outputSize: 'Output Size',
    tilesPerRow: 'Tiles per Row',
    tilesPerColumn: 'Tiles per Column',
    totalTiles: 'Total Tiles',
    availableTiles: 'Available Tiles',
    updating: 'updating...',

    // Validation
    invalidTileSize: 'Invalid tile size for selected mode',
    tileSizeNotDivisible: 'Tile size {tileSize} is not divisible by {dim} (required for mode {mode}). Valid sizes: {validSizes}',
    insufficientTiles: 'Insufficient tiles for no-repeat mode',
    noRepeatRequires: 'No-repeat mode requires {required} tiles, but only {available} are available. Either reduce image size, increase downsample, or disable no-repeat.',
    tooManyTiles: 'Too many tiles',

    // Progress
    gettingUploadUrl: 'Getting upload URL...',
    uploadingImage: 'Uploading image...',
    creatingMosaic: 'Creating mosaic...',
    startingJob: 'Starting generation job...',
    failedToCreate: 'Failed to create mosaic',
    creating: 'Creating...',
  },

  // Mosaic Detail page
  mosaicDetail: {
    backToDashboard: 'Back to Dashboard',
    mainMosaic: 'Main Mosaic',
    generatingMosaic: 'Generating mosaic...',
    pendingGeneration: 'Pending generation',
    failedToLoad: 'Failed to load mosaic',

    // Actions
    setAsMain: 'Set as Main',
    setting: 'Setting...',
    regenerate: 'Regenerate',
    starting: 'Starting...',
    viewFullSize: 'View Full Size',
    openMosaicViewer: 'Open Mosaic Viewer',

    // Delete modal
    deleteMosaic: 'Delete Mosaic',
    deleteConfirmation: 'Are you sure you want to delete this mosaic? This action cannot be undone.',

    // Details section
    details: 'Details',
    created: 'Created',
    tileSizeLabel: 'Tile Size',
    modeLabel: 'Mode',
    tintOpacityLabel: 'Tint Opacity',
    noRepeatLabel: 'No Repeat',
    cropTilesLabel: 'Crop Tiles',
    downsampleLabel: 'Downsample',
    randomizeLabel: 'Randomize',
    excludedFolders: 'Excluded Folders',

    // Stats
    generationStats: 'Generation Statistics',
    totalTilesLabel: 'Total Tiles',
    uniqueImages: 'Unique Images',
    gridSize: 'Grid Size',
    tileDiversity: 'Tile Diversity',
    colorMatchingQuality: 'Color Matching Quality',
    bestMatch: 'Best Match',
    average: 'Average',
    worstMatch: 'Worst Match',
    mostUsedTiles: 'Most Used Tiles',
    worstColorMatches: 'Worst Color Matches',

    // Distance visualization
    distanceVisualization: 'Distance Visualization',
    distanceDescription: 'Grayscale heatmap showing tile matching quality. Darker areas indicate better color matches, lighter areas indicate tiles that differ more from the source image.',

    // Job history
    jobHistory: 'Job History',
    duration: 'Duration',

    // Errors
    generationFailed: 'Generation Failed',
    errorCode: 'Error Code',
    suggestion: 'Suggestion',

    // Error codes
    errors: {
      INSUFFICIENT_TILES: {
        title: 'Insufficient Tiles',
        description: 'The mosaic requires more unique tile images than are currently available.',
        suggestion: 'Upload more tile images to the tile collection, reduce the mosaic size, or disable the "no-repeat" option to allow tile reuse.',
      },
      MISSING_SOURCE_IMAGE: {
        title: 'Source Image Not Found',
        description: 'The source image could not be found or downloaded.',
        suggestion: 'Verify that the source image was uploaded correctly and try regenerating the mosaic.',
      },
      MISSING_TILES: {
        title: 'No Tiles Available',
        description: 'No tile images were found in the tile collection.',
        suggestion: 'Upload tile images to the tile collection before generating a mosaic.',
      },
      GENERATION_FAILED: {
        title: 'Generation Failed',
        description: 'The mosaic generation process encountered an error.',
        suggestion: 'Check the CloudWatch logs for detailed error information or try regenerating with different settings.',
      },
      UPLOAD_FAILED: {
        title: 'Upload Failed',
        description: 'The generated mosaic could not be uploaded to storage.',
        suggestion: 'Check S3 permissions and try regenerating the mosaic.',
      },
      UNKNOWN: {
        title: 'Unknown Error',
        description: 'An unexpected error occurred.',
        suggestion: 'Try regenerating the mosaic or contact support if the issue persists.',
      },
    },
  },

  // Job Status page
  jobStatus: {
    backToDashboard: 'Back to Dashboard',
    loadingJobStatus: 'Loading job status...',
    failedToLoad: 'Failed to load job status',

    // Status messages
    statuses: {
      pending: {
        title: 'Pending',
        description: 'Job is queued and waiting to start...',
      },
      submitted: {
        title: 'Submitted',
        description: 'Job has been submitted and is waiting to be picked up...',
      },
      running: {
        title: 'Running',
        description: 'Generating your mosaic. This may take a few minutes...',
      },
      succeeded: {
        title: 'Completed',
        description: 'Your mosaic has been generated successfully!',
      },
      failed: {
        title: 'Failed',
        description: 'Something went wrong during generation.',
      },
      cancelled: {
        title: 'Cancelled',
        description: 'The job was cancelled.',
      },
    },

    // Info
    jobId: 'Job ID',
    started: 'Started',
    durationLabel: 'Duration',

    // Actions
    cancelJob: 'Cancel Job',
    cancelling: 'Cancelling...',
    viewMosaic: 'View Mosaic',
    backToMosaic: 'Back to Mosaic',
  },

  // User Management page
  userManagement: {
    title: 'User Management',
    subtitle: 'Manage admin users who can access the mosaic dashboard',
    addUser: 'Add User',

    // Tabs
    usersTab: 'Users',
    pendingTab: 'Pending Requests',

    // Status labels
    statusLabels: {
      active: 'Active',
      pending: 'Pending',
      passwordReset: 'Password Reset',
      resetRequired: 'Reset Required',
      archived: 'Archived',
      compromised: 'Compromised',
      disabled: 'Disabled',
      pendingApproval: 'Pending Approval',
    },

    // Actions
    resendInvite: 'Resend invitation email',
    noUsersFound: 'No users found',
    noPendingRegistrations: 'No pending registration requests',
    createdLabel: 'Created',
    requestedLabel: 'Requested',

    // Approve/Reject
    approve: 'Approve',
    approving: 'Approving...',
    reject: 'Reject',
    rejecting: 'Rejecting...',
    registrationApproved: 'Registration approved. User will receive an invitation email.',
    registrationRejected: 'Registration rejected.',
    failedToApprove: 'Failed to approve registration',
    failedToReject: 'Failed to reject registration',

    // Create user modal
    addNewUser: 'Add New User',
    newUserInstructions: 'Enter the email address for the new admin user. They will receive an invitation email with a temporary password.',
    emailAddressLabel: 'Email address',
    emailPlaceholder: 'admin@example.com',
    createUser: 'Create User',
    creatingUser: 'Creating...',

    // Delete user modal
    deleteUser: 'Delete User',
    deleteUserConfirmation: 'Are you sure you want to delete',
    cannotBeUndone: 'This action cannot be undone.',

    // Success/error messages
    userCreatedSuccess: 'User created successfully',
    userDeletedSuccess: 'User deleted successfully',
    invitationResent: 'Invitation resent successfully',
    userEnabled: 'User enabled successfully',
    userDisabled: 'User disabled successfully',
    failedToCreateUser: 'Failed to create user',
    failedToDeleteUser: 'Failed to delete user',
    failedToResendInvite: 'Failed to resend invitation',
    failedToEnableUser: 'Failed to enable user',
    failedToDisableUser: 'Failed to disable user',
    errorLoadingUsers: 'Error loading users',
  },

  // Upload Images page
  uploadImages: {
    title: 'Upload Images',
    subtitle: 'Upload images to be stored in S3 organized by year and user',

    // Year selection
    imageYear: 'Image Year',
    yearHelp: 'Select the year these images belong to. If images have EXIF data, the year will be extracted automatically.',

    // Drop zone
    clickToUpload: 'Click to upload',
    orDragAndDrop: 'or drag and drop',
    fileTypes: 'PNG, JPG, GIF, WebP up to 10MB each',

    // File list
    selectedFiles: 'Selected Files',
    uploaded: 'uploaded',
    duplicates: 'duplicates',
    failedPlural: 'failed',
    clearAll: 'Clear All',
    uploadButton: 'Upload',
    uploadingButton: 'Uploading...',
    image: 'Image',
    images: 'Images',
    uploadDestination: 'Images will be uploaded to',

    // Status badges
    statusUploading: 'Uploading',
    statusUploaded: 'Uploaded',
    statusDuplicate: 'Duplicate',
    statusInvalid: 'Invalid',
    statusError: 'Error',
    statusPending: 'Pending',
    duplicateImage: 'Duplicate image',
    invalidImage: 'Invalid image',
    uploadFailed: 'Upload failed',
  },

  // Error Logs page
  errorLogs: {
    title: 'Error Logs',
    subtitle: 'Monitor client-side errors for debugging and investigation',

    // Filters
    filterByCategory: 'Category',
    filterBySeverity: 'Severity',
    allCategories: 'All Categories',
    allSeverities: 'All Severities',
    refresh: 'Refresh',
    refreshing: 'Refreshing...',

    // Categories
    categories: {
      mosaic_creation: 'Mosaic Creation',
      image_upload: 'Image Upload',
      api_request: 'API Request',
      authentication: 'Authentication',
      file_processing: 'File Processing',
      unknown: 'Unknown',
    },

    // Severities
    severities: {
      error: 'Error',
      warning: 'Warning',
      info: 'Info',
    },

    // Table headers
    timestamp: 'Timestamp',
    category: 'Category',
    severity: 'Severity',
    message: 'Message',
    step: 'Step',
    user: 'User',
    details: 'Details',

    // Empty state
    noErrors: 'No error logs found',
    noErrorsDescription: 'Error logs will appear here when client-side errors are recorded.',

    // Loading
    loading: 'Loading error logs...',
    loadMore: 'Load More',
    loadingMore: 'Loading more...',

    // Error detail modal
    errorDetails: 'Error Details',
    originalError: 'Original Error',
    stackTrace: 'Stack Trace',
    context: 'Context',
    userAgent: 'User Agent',
    url: 'URL',
    clientTimestamp: 'Client Time',
    serverTimestamp: 'Server Time',
    close: 'Close',

    // Errors
    failedToLoad: 'Failed to load error logs',
  },
};

export type Translations = typeof en;
