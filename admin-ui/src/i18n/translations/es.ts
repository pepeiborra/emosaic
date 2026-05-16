import type { Translations } from './en';

export const es: Translations = {
  // Common
  common: {
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    delete: 'Eliminar',
    save: 'Guardar',
    create: 'Crear',
    edit: 'Editar',
    back: 'Volver',
    loading: 'Cargando...',
    error: 'Error',
    success: 'Correcto',
    yes: 'Si',
    no: 'No',
    main: 'Principal',
    remove: 'Quitar',
    enable: 'Habilitar',
    disable: 'Deshabilitar',
    deleting: 'Eliminando...',
  },

  // Navigation
  nav: {
    dashboard: 'Panel',
    createMosaic: 'Crear mosaico',
    uploadImages: 'Subir imagenes',
    users: 'Usuarios',
    errorLogs: 'Registro de errores',
    signOut: 'Cerrar sesion',
    openSidebar: 'Abrir menu',
    appTitle: 'Casa del manco Admin',
  },

  // Login page
  login: {
    title: 'Casa del Manco',
    subtitle: 'Inicia sesion',
    emailLabel: 'Correo electronico',
    emailPlaceholder: 'Correo electronico',
    passwordLabel: 'Contrasena',
    passwordPlaceholder: 'Contrasena',
    forgotPassword: 'Olvidaste tu contrasena?',
    signIn: 'Iniciar sesion',
    signingIn: 'Iniciando sesion...',
    noAccount: 'No tienes cuenta?',
    requestAccess: 'Solicitar acceso',
    signInWithGoogle: 'Continuar con Google',
    signInWithFacebook: 'Continuar con Facebook',
    or: 'o',

    // New password
    setNewPassword: 'Establecer nueva contrasena',
    newPasswordRequired: 'Tu cuenta requiere una nueva contrasena',
    newPassword: 'Nueva contrasena',
    confirmPassword: 'Confirmar contrasena',
    passwordsDoNotMatch: 'Las contrasenas no coinciden',
    passwordRequirements: 'La contrasena debe tener al menos 10 caracteres.',
    setPassword: 'Establecer contrasena',
    settingPassword: 'Estableciendo contrasena...',

    // Forgot password
    resetPassword: 'Restablecer contrasena',
    enterEmailForReset: 'Introduce tu correo para recibir un codigo de verificacion',
    sendResetCode: 'Enviar codigo',
    sending: 'Enviando...',
    backToSignIn: 'Volver a iniciar sesion',
    verificationCodeSent: 'Se ha enviado un codigo de verificacion a tu correo',

    // Reset password
    enterNewPassword: 'Introduce nueva contrasena',
    checkEmailForCode: 'Revisa tu correo para obtener el codigo de verificacion',
    verificationCode: 'Codigo de verificacion',
    enterCodeFromEmail: 'Introduce el codigo del correo',
    resetting: 'Restableciendo...',
    passwordResetSuccess: 'Contrasena restablecida correctamente. Por favor, inicia sesion.',
  },

  // OAuth callback page
  callback: {
    signingIn: 'Iniciando sesion...',
    failed: 'No se pudo iniciar sesion. Intentalo de nuevo.',
    backToLogin: 'Volver a iniciar sesion',
  },

  // Register page
  register: {
    title: 'Solicitar Acceso',
    subtitle: 'Completa el formulario para solicitar acceso al panel de administracion',
    nameLabel: 'Nombre completo',
    namePlaceholder: 'Tu nombre',
    emailLabel: 'Correo electronico',
    emailPlaceholder: 'tu@correo.com',
    captchaLabel: 'Pregunta de seguridad',
    captchaPlaceholder: 'Introduce la respuesta',
    refreshCaptcha: 'Nueva pregunta',
    submit: 'Enviar solicitud',
    submitting: 'Enviando...',
    alreadyHaveAccount: 'Ya tienes cuenta? Iniciar sesion',
    backToLogin: 'Volver al inicio de sesion',
    successTitle: 'Solicitud enviada',
    successMessage: 'Tu solicitud de acceso ha sido enviada. Un administrador la revisara y recibiras un correo cuando tu cuenta sea aprobada.',
    captchaLoadError: 'Error al cargar la pregunta de seguridad. Por favor, intentalo de nuevo.',
    submitError: 'Error al enviar la solicitud. Por favor, intentalo de nuevo.',
  },

  // Dashboard
  dashboard: {
    title: 'Mosaicos',
    subtitle: 'Gestiona tus foto mosaicos',
    createNew: 'Crear nuevo',
    noMosaics: 'Sin mosaicos',
    getStarted: 'Comienza creando un nuevo mosaico.',
    createMosaic: 'Crear mosaico',
    failedToLoad: 'Error al cargar mosaicos',
    unknownError: 'Error desconocido',
  },

  // Status badges
  status: {
    pending: 'pendiente',
    processing: 'procesando',
    completed: 'completado',
    failed: 'fallido',
    running: 'ejecutando',
    succeeded: 'completado',
    cancelled: 'cancelado',
    submitted: 'enviado',
  },

  // Create Mosaic page
  createMosaic: {
    title: 'Crear mosaico',
    subtitle: 'Sube una imagen de origen y configura los ajustes de generacion del mosaico.',
    sourceImage: 'Imagen de origen',
    clickOrDrag: 'Haz clic o arrastra para subir',
    fileLimit: 'PNG, JPG hasta 20MB',
    titleLabel: 'Titulo (opcional)',
    titlePlaceholder: 'Mi mosaico',

    // Tile settings
    tileSize: 'Tamano de tesela',
    tileSizeHelp: 'Teselas mas pequenas = mas detalle pero mayor tamano de salida',
    tileSizeDivisible: 'debe ser divisible por {dim} para el modo {mode}',

    // Downsample
    downsample: 'Factor de reduccion',
    noDownsampling: 'sin reduccion',
    resolution: '1/{factor} resolucion',
    downsampleHelp: 'Valores mas altos reducen el tamano de salida y el tiempo de procesamiento',

    // Mode
    matchingMode: 'Modo de coincidencia',
    singleColorMatch: '1x1, coincidencia de color unico',
    gridMatching: 'coincidencia de cuadricula {dim}x{dim}',
    bestQuality: 'mejor calidad',
    randomIgnoreSource: 'Aleatorio (ignorar origen)',
    modeHelp: 'Valores mas altos analizan mas segmentos por tesela para mejor coincidencia',

    // Tint
    tintOpacity: 'Opacidad del tinte',
    tintHelp: 'Valores mas altos mezclan la imagen de origen de forma mas visible',

    // Checkboxes
    noRepeat: 'Sin teselas repetidas (usa algoritmo hungaro)',
    cropTiles: 'Recortar teselas a cuadrado (en lugar de redimensionar)',
    skipCache: 'Omitir cache de teselas (volver a preparar todas)',
    skipCacheHelp: 'Ignora la cache de teselas preparadas. Util si las mini-teselas del mosaico no coinciden con la tesela enlazada.',

    // Tile folders
    tileFolders: 'Carpetas de teselas',
    includedOf: 'de',
    included: 'incluidas',
    loadingFolders: 'Cargando carpetas...',
    noFolders: 'No se encontraron carpetas en el directorio de teselas',
    uncheckFolders: 'Desmarca las carpetas para excluirlas de la generacion del mosaico',

    // Preview stats
    mosaicPreview: 'Vista previa del mosaico',
    sourceImageLabel: 'Imagen de origen',
    outputSize: 'Tamano de salida',
    tilesPerRow: 'Teselas por fila',
    tilesPerColumn: 'Teselas por columna',
    totalTiles: 'Total de teselas',
    availableTiles: 'Teselas disponibles',
    updating: 'actualizando...',

    // Validation
    invalidTileSize: 'Tamano de tesela no valido para el modo seleccionado',
    tileSizeNotDivisible: 'El tamano de tesela {tileSize} no es divisible por {dim} (requerido para el modo {mode}). Tamanos validos: {validSizes}',
    insufficientTiles: 'Teselas insuficientes para el modo sin repeticion',
    noRepeatRequires: 'El modo sin repeticion requiere {required} teselas, pero solo hay {available} disponibles. Reduce el tamano de la imagen, aumenta el factor de reduccion o desactiva sin repeticion.',
    tooManyTiles: 'Demasiadas teselas',

    // Progress
    gettingUploadUrl: 'Obteniendo URL de subida...',
    uploadingImage: 'Subiendo imagen...',
    creatingMosaic: 'Creando mosaico...',
    startingJob: 'Iniciando trabajo de generacion...',
    failedToCreate: 'Error al crear mosaico',
    creating: 'Creando...',
  },

  // Mosaic Detail page
  mosaicDetail: {
    backToDashboard: 'Volver al panel',
    mainMosaic: 'Mosaico principal',
    generatingMosaic: 'Generando mosaico...',
    pendingGeneration: 'Pendiente de generacion',
    failedToLoad: 'Error al cargar mosaico',

    // Actions
    setAsMain: 'Establecer como principal',
    setting: 'Estableciendo...',
    regenerate: 'Regenerar',
    skipCacheLabel: 'Omitir cache de teselas',
    starting: 'Iniciando...',
    viewFullSize: 'Ver tamano completo',
    openMosaicViewer: 'Abrir visor de mosaico',

    // Delete modal
    deleteMosaic: 'Eliminar mosaico',
    deleteConfirmation: 'Estas seguro de que quieres eliminar este mosaico? Esta accion no se puede deshacer.',

    // Details section
    details: 'Detalles',
    created: 'Creado',
    tileSizeLabel: 'Tamano de tesela',
    modeLabel: 'Modo',
    tintOpacityLabel: 'Opacidad del tinte',
    noRepeatLabel: 'Sin repeticion',
    cropTilesLabel: 'Recortar teselas',
    downsampleLabel: 'Factor de reduccion',
    randomizeLabel: 'Aleatorizar',
    excludedFolders: 'Carpetas excluidas',

    // Stats
    generationStats: 'Estadisticas de generacion',
    totalTilesLabel: 'Total de teselas',
    uniqueImages: 'Imagenes unicas',
    gridSize: 'Tamano de cuadricula',
    tileDiversity: 'Diversidad de teselas',
    colorMatchingQuality: 'Calidad de coincidencia de color',
    bestMatch: 'Mejor coincidencia',
    average: 'Promedio',
    worstMatch: 'Peor coincidencia',
    mostUsedTiles: 'Teselas mas usadas',
    worstColorMatches: 'Peores coincidencias de color',

    // Distance visualization
    distanceVisualization: 'Visualizacion de distancia',
    distanceDescription: 'Mapa de calor en escala de grises que muestra la calidad de coincidencia de teselas. Las areas mas oscuras indican mejores coincidencias de color, las areas mas claras indican teselas que difieren mas de la imagen de origen.',

    // Job history
    jobHistory: 'Historial de trabajos',
    duration: 'Duracion',

    // Errors
    generationFailed: 'Generacion fallida',
    errorCode: 'Codigo de error',
    suggestion: 'Sugerencia',

    // Error codes
    errors: {
      INSUFFICIENT_TILES: {
        title: 'Teselas insuficientes',
        description: 'El mosaico requiere mas imagenes de teselas unicas de las que estan disponibles actualmente.',
        suggestion: 'Sube mas imagenes de teselas a la coleccion, reduce el tamano del mosaico o desactiva la opcion "sin repeticion" para permitir la reutilizacion de teselas.',
      },
      MISSING_SOURCE_IMAGE: {
        title: 'Imagen de origen no encontrada',
        description: 'La imagen de origen no se pudo encontrar o descargar.',
        suggestion: 'Verifica que la imagen de origen se subio correctamente e intenta regenerar el mosaico.',
      },
      MISSING_TILES: {
        title: 'Sin teselas disponibles',
        description: 'No se encontraron imagenes de teselas en la coleccion.',
        suggestion: 'Sube imagenes de teselas a la coleccion antes de generar un mosaico.',
      },
      GENERATION_FAILED: {
        title: 'Generacion fallida',
        description: 'El proceso de generacion del mosaico encontro un error.',
        suggestion: 'Revisa los logs de CloudWatch para obtener informacion detallada del error o intenta regenerar con diferentes ajustes.',
      },
      UPLOAD_FAILED: {
        title: 'Subida fallida',
        description: 'El mosaico generado no se pudo subir al almacenamiento.',
        suggestion: 'Verifica los permisos de S3 e intenta regenerar el mosaico.',
      },
      UNKNOWN: {
        title: 'Error desconocido',
        description: 'Ocurrio un error inesperado.',
        suggestion: 'Intenta regenerar el mosaico o contacta con soporte si el problema persiste.',
      },
    },
  },

  // Job Status page
  jobStatus: {
    backToDashboard: 'Volver al panel',
    loadingJobStatus: 'Cargando estado del trabajo...',
    failedToLoad: 'Error al cargar estado del trabajo',

    // Status messages
    statuses: {
      pending: {
        title: 'Pendiente',
        description: 'El trabajo esta en cola esperando para comenzar...',
      },
      submitted: {
        title: 'Enviado',
        description: 'El trabajo ha sido enviado y esta esperando ser procesado...',
      },
      running: {
        title: 'Ejecutando',
        description: 'Generando tu mosaico. Esto puede tardar unos minutos...',
      },
      succeeded: {
        title: 'Completado',
        description: 'Tu mosaico ha sido generado correctamente!',
      },
      failed: {
        title: 'Fallido',
        description: 'Algo salio mal durante la generacion.',
      },
      cancelled: {
        title: 'Cancelado',
        description: 'El trabajo fue cancelado.',
      },
    },

    // Info
    jobId: 'ID del trabajo',
    started: 'Iniciado',
    durationLabel: 'Duracion',

    // Actions
    cancelJob: 'Cancelar trabajo',
    cancelling: 'Cancelando...',
    viewMosaic: 'Ver mosaico',
    backToMosaic: 'Volver al mosaico',
  },

  // User Management page
  userManagement: {
    title: 'Gestion de usuarios',
    subtitle: 'Gestiona los usuarios administradores que pueden acceder al panel de mosaicos',
    addUser: 'Anadir usuario',

    // Tabs
    usersTab: 'Usuarios',
    pendingTab: 'Solicitudes pendientes',

    // Status labels
    statusLabels: {
      active: 'Activo',
      pending: 'Pendiente',
      passwordReset: 'Cambio de contrasena',
      resetRequired: 'Requiere reinicio',
      archived: 'Archivado',
      compromised: 'Comprometido',
      disabled: 'Deshabilitado',
      pendingApproval: 'Pendiente de aprobacion',
    },

    // Actions
    resendInvite: 'Reenviar correo de invitacion',
    noUsersFound: 'No se encontraron usuarios',
    noPendingRegistrations: 'No hay solicitudes de registro pendientes',
    createdLabel: 'Creado',
    requestedLabel: 'Solicitado',

    // Approve/Reject
    approve: 'Aprobar',
    approving: 'Aprobando...',
    reject: 'Rechazar',
    rejecting: 'Rechazando...',
    registrationApproved: 'Registro aprobado. El usuario recibira un correo de invitacion.',
    registrationRejected: 'Registro rechazado.',
    failedToApprove: 'Error al aprobar el registro',
    failedToReject: 'Error al rechazar el registro',

    // Create user modal
    addNewUser: 'Anadir nuevo usuario',
    newUserInstructions: 'Introduce el correo electronico del nuevo usuario administrador. Recibira un correo de invitacion con una contrasena temporal.',
    emailAddressLabel: 'Correo electronico',
    emailPlaceholder: 'admin@ejemplo.com',
    createUser: 'Crear usuario',
    creatingUser: 'Creando...',

    // Delete user modal
    deleteUser: 'Eliminar usuario',
    deleteUserConfirmation: 'Estas seguro de que quieres eliminar a',
    cannotBeUndone: 'Esta accion no se puede deshacer.',

    // Success/error messages
    userCreatedSuccess: 'Usuario creado correctamente',
    userDeletedSuccess: 'Usuario eliminado correctamente',
    invitationResent: 'Invitacion reenviada correctamente',
    userEnabled: 'Usuario habilitado correctamente',
    userDisabled: 'Usuario deshabilitado correctamente',
    failedToCreateUser: 'Error al crear usuario',
    failedToDeleteUser: 'Error al eliminar usuario',
    failedToResendInvite: 'Error al reenviar invitacion',
    failedToEnableUser: 'Error al habilitar usuario',
    failedToDisableUser: 'Error al deshabilitar usuario',
    errorLoadingUsers: 'Error al cargar usuarios',
  },

  // Upload Images page
  uploadImages: {
    title: 'Subir imagenes',
    subtitle: 'Sube imagenes para almacenarlas en S3 organizadas por ano y usuario',

    // Year selection
    imageYear: 'Ano de la imagen',
    yearHelp: 'Selecciona el ano al que pertenecen estas imagenes. Si las imagenes tienen datos EXIF, el ano se extraera automaticamente.',

    // Drop zone
    clickToUpload: 'Haz clic para subir',
    orDragAndDrop: 'o arrastra y suelta',
    fileTypes: 'PNG, JPG, GIF, WebP hasta 10MB cada uno',

    // File list
    selectedFiles: 'Archivos seleccionados',
    uploaded: 'subidos',
    duplicates: 'duplicados',
    failedPlural: 'fallidos',
    clearAll: 'Limpiar todo',
    uploadButton: 'Subir',
    uploadingButton: 'Subiendo...',
    image: 'imagen',
    images: 'imagenes',
    uploadDestination: 'Las imagenes se subiran a',

    // Status badges
    statusUploading: 'Subiendo',
    statusUploaded: 'Subido',
    statusDuplicate: 'Duplicado',
    statusInvalid: 'No valido',
    statusError: 'Error',
    statusPending: 'Pendiente',
    duplicateImage: 'Imagen duplicada',
    invalidImage: 'Imagen no valida',
    uploadFailed: 'Error al subir',
  },

  // Error Logs page
  errorLogs: {
    title: 'Registro de errores',
    subtitle: 'Monitorear errores del cliente para depuracion e investigacion',

    // Filters
    filterByCategory: 'Categoria',
    filterBySeverity: 'Severidad',
    allCategories: 'Todas las categorias',
    allSeverities: 'Todas las severidades',
    refresh: 'Actualizar',
    refreshing: 'Actualizando...',

    // Categories
    categories: {
      mosaic_creation: 'Creacion de mosaico',
      image_upload: 'Subida de imagen',
      api_request: 'Solicitud API',
      authentication: 'Autenticacion',
      file_processing: 'Procesamiento de archivo',
      unknown: 'Desconocido',
    },

    // Severities
    severities: {
      error: 'Error',
      warning: 'Advertencia',
      info: 'Info',
    },

    // Table headers
    timestamp: 'Fecha y hora',
    category: 'Categoria',
    severity: 'Severidad',
    message: 'Mensaje',
    step: 'Paso',
    user: 'Usuario',
    details: 'Detalles',

    // Empty state
    noErrors: 'No se encontraron errores',
    noErrorsDescription: 'Los errores apareceran aqui cuando se registren errores del cliente.',

    // Loading
    loading: 'Cargando errores...',
    loadMore: 'Cargar mas',
    loadingMore: 'Cargando mas...',

    // Error detail modal
    errorDetails: 'Detalles del error',
    originalError: 'Error original',
    stackTrace: 'Traza de pila',
    context: 'Contexto',
    userAgent: 'User Agent',
    url: 'URL',
    clientTimestamp: 'Hora del cliente',
    serverTimestamp: 'Hora del servidor',
    close: 'Cerrar',

    // Errors
    failedToLoad: 'Error al cargar los errores',
  },
};
