/**
 * ShopAI — Frontend Application Logic
 * Pure Vanilla JavaScript (HTML5 / CSS3 / ES6+)
 * 
 * Features:
 * - 3 distinct views: Sign-in, Product Catalogue, Add/Edit Product
 * - Local demo session authentication (admin / admin@124)
 * - IndexedDB storage engine for products and images
 * - Initial 10 sample products seeded once
 * - Real API integration with FastAPI / BLIP backend
 * - Safe DOM updates to prevent XSS
 */

(function () {
  'use strict';

  // =========================================================================
  // CONSTANTS & CONFIGURATION
  // =========================================================================
  const DEMO_USER = 'admin';
  const DEMO_PASS = 'admin@124';
  const SESSION_KEY = 'shopai_auth_session';
  const DB_NAME = 'ShopAIDatabase';
  const DB_VERSION = 1;
  const STORE_NAME = 'products';
  const SEEDED_KEY = 'shopai_catalogue_seeded_v1';
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  // Currency Formatter for Indian Rupee (₹)
  const inrFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  });

  // =========================================================================
  // APPLICATION STATE
  // =========================================================================
  const state = {
    currentView: 'signin', // 'signin' | 'catalogue' | 'editor'
    products: [],
    currentProductId: null,
    currentImageBlob: null,
    currentImageObjectURL: null,
    isDirty: false,
    hasGeneratedContent: false,
    backendStatus: { online: false, modelLoaded: false, device: 'unknown' }
  };

  // =========================================================================
  // INDEXEDDB DATA LAYER
  // =========================================================================
  const db = {
    _db: null,

    async init() {
      if (this._db) return this._db;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const dbInstance = e.target.result;
          if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
            const store = dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = (e) => {
          this._db = e.target.result;
          resolve(this._db);
        };
        req.onerror = (e) => {
          console.error('IndexedDB open error:', e);
          reject(e.target.error);
        };
      });
    },

    async getAll() {
      const database = await this.init();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async getById(id) {
      const database = await this.init();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    async put(record) {
      const database = await this.init();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async delete(id) {
      const database = await this.init();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },

    async clear() {
      const database = await this.init();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }
  };

  // =========================================================================
  // 10 INITIAL SAMPLE PRODUCTS WITH SVG PLACEHOLDERS
  // =========================================================================
  function createSampleSVG(name, iconSvg, bgColor, fgColor) {
    const svgStr = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
        <rect width="100%" height="100%" fill="${bgColor}"/>
        <g fill="none" stroke="${fgColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(160, 80) scale(3.5)">
          ${iconSvg}
        </g>
        <rect x="20" y="235" width="360" height="45" rx="6" fill="rgba(0,0,0,0.18)"/>
        <text x="200" y="262" font-family="-apple-system, Inter, sans-serif" font-size="16" font-weight="600" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">
          ${name}
        </text>
      </svg>
    `.trim();
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgStr);
  }

  const SAMPLE_ICONS = {
    shirt: '<path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    dress: '<path d="M12 2a3 3 0 0 0-3 3v2l-4 3 2 12h10l2-12-4-3V5a3 3 0 0 0-3-3z"/>',
    sneaker: '<path d="M2 17l2 3h16l2-3v-4l-6-2-4 3H4l-2 3z"/><path d="M6 14l2-3 4-1"/>',
    bag: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/>',
    watch: '<circle cx="12" cy="12" r="7"/><polyline points="12 9 12 12 14 14"/><path d="M12 5V2M12 22v-3"/>',
    backpack: '<rect x="4" y="6" width="16" height="15" rx="3"/><path d="M9 6V4a3 3 0 0 1 6 0v2"/><path d="M8 12h8"/>'
  };

  const INITIAL_10_SAMPLES = [
    {
      id: 'sample_01',
      title: 'Classic Blue Shirt',
      generatedTitle: 'Classic Blue Shirt',
      brand: 'Nordic Weave',
      category: 'Clothing',
      customCategory: '',
      imageSrc: createSampleSVG('Classic Blue Shirt', SAMPLE_ICONS.shirt, '#1e3a8a', '#93c5fd'),
      caption: 'a dark blue collared shirt displayed against a studio background',
      visualAttributes: {
        category: { value: 'Clothing', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Navy Blue', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Collared button-up silhouette', confidence: 'medium', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Smooth woven finish', confidence: 'low', source: 'sample seed' }
      },
      description: 'Presenting the Classic Blue Shirt by Nordic Weave, tailored for versatile everyday sophistication. Featuring a clean collared neckline and rich navy visual finish, this essential piece transitions seamlessly between casual and smart-casual settings.\n\nPlease note: Verify sizing specifications and material care guidelines before publishing.',
      features: [
        'Brand: Nordic Weave',
        'Category: Clothing',
        'Dominant Visible Color: Navy Blue',
        'Silhouette: Collared button-up design',
        'Merchant Notice: Confirm exact fabric composition with inventory'
      ],
      price: 1499,
      quantity: 45,
      sku: 'CLO-BLU-001',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-10T10:00:00.000Z',
      updatedAt: '2026-01-10T10:00:00.000Z'
    },
    {
      id: 'sample_02',
      title: 'Floral Summer Dress',
      generatedTitle: 'Floral Summer Dress',
      brand: 'Aura Bloom',
      category: 'Clothing',
      customCategory: '',
      imageSrc: createSampleSVG('Floral Summer Dress', SAMPLE_ICONS.dress, '#be185d', '#fbcfe8'),
      caption: 'a colorful floral print summer dress on a hanger',
      visualAttributes: {
        category: { value: 'Clothing', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Coral Pink', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Flowing dress silhouette', confidence: 'medium', source: 'sample seed' },
        pattern: { value: 'Floral pattern', confidence: 'high', source: 'sample seed' },
        visible_texture: { value: 'Lightweight draped texture', confidence: 'low', source: 'sample seed' }
      },
      description: 'The Floral Summer Dress by Aura Bloom delivers an effortless warm-weather aesthetic. Highlighted by an all-over floral print over a coral blush backdrop, its relaxed silhouette captures breezy elegance.\n\nPlease note: Sizing details and fabric wash instructions should be verified prior to store listing.',
      features: [
        'Brand: Aura Bloom',
        'Category: Clothing',
        'Pattern: Distinct floral print',
        'Dominant Visible Color: Coral Pink',
        'Profile: Flowing summer silhouette'
      ],
      price: 2299,
      quantity: 20,
      sku: 'CLO-DRS-002',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-11T11:00:00.000Z',
      updatedAt: '2026-01-11T11:00:00.000Z'
    },
    {
      id: 'sample_03',
      title: 'Everyday Sneakers',
      generatedTitle: 'Everyday Sneakers',
      brand: 'Stride & Co',
      category: 'Footwear',
      customCategory: '',
      imageSrc: createSampleSVG('Everyday Sneakers', SAMPLE_ICONS.sneaker, '#334155', '#cbd5e1'),
      caption: 'a pair of minimalist low-top sneakers on a white floor',
      visualAttributes: {
        category: { value: 'Footwear', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'White', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Low-top streamlined profile', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Smooth matte finish', confidence: 'low', source: 'sample seed' }
      },
      description: 'Step out in clean comfort with the Everyday Sneakers from Stride & Co. Designed with a timeless low-profile lace-up aesthetic and neutral monochrome styling that matches any modern wardrobe.\n\nPlease note: Check outsole dimensions and cushion specifications for physical inventory accuracy.',
      features: [
        'Brand: Stride & Co',
        'Category: Footwear',
        'Profile: Streamlined low-top profile',
        'Primary Color: Crisp White with neutral accents',
        'Lacing: Classic lace-up silhouette'
      ],
      price: 3499,
      quantity: 30,
      sku: 'FTW-SNK-003',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-12T09:30:00.000Z',
      updatedAt: '2026-01-12T09:30:00.000Z'
    },
    {
      id: 'sample_04',
      title: 'Structured Handbag',
      generatedTitle: 'Structured Handbag',
      brand: 'Maison Luxe',
      category: 'Bags',
      customCategory: '',
      imageSrc: createSampleSVG('Structured Handbag', SAMPLE_ICONS.bag, '#78350f', '#fde68a'),
      caption: 'a structured leather-look tote bag with top handles',
      visualAttributes: {
        category: { value: 'Bags', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Tan / Camel', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Structured tote with dual handles', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Smooth surface finish', confidence: 'low', source: 'sample seed' }
      },
      description: 'The Structured Handbag by Maison Luxe balances clean geometric lines with practical daily capacity. Featuring sturdy dual handles and rich camel tones, it serves as a sophisticated companion for work or outings.\n\nPlease note: Confirm compartment layout and material composition with your supplier.',
      features: [
        'Brand: Maison Luxe',
        'Category: Bags',
        'Silhouette: Structured tote with reinforced handles',
        'Visible Color: Tan / Camel',
        'Closure: Top zip profile'
      ],
      price: 4199,
      quantity: 15,
      sku: 'BAG-HND-004',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-13T14:20:00.000Z',
      updatedAt: '2026-01-13T14:20:00.000Z'
    },
    {
      id: 'sample_05',
      title: 'Minimal Wristwatch',
      generatedTitle: 'Minimal Wristwatch',
      brand: 'Chronos Lab',
      category: 'Accessories',
      customCategory: '',
      imageSrc: createSampleSVG('Minimal Wristwatch', SAMPLE_ICONS.watch, '#0f172a', '#e2e8f0'),
      caption: 'a minimalist analog wristwatch with clean round dial',
      visualAttributes: {
        category: { value: 'Accessories', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Dark Charcoal', confidence: 'medium', source: 'sample seed' },
        shape_style: { value: 'Analog round dial with band', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Glossy reflective surface', confidence: 'low', source: 'sample seed' }
      },
      description: 'Defined by understated balance, the Minimal Wristwatch by Chronos Lab highlights a clean dial face and contemporary slim casing. A refined daily accessory that complements professional and weekend attire.\n\nPlease note: Specify movement type, water-resistance rating, and strap dimensions from physical manufacturer spec.',
      features: [
        'Brand: Chronos Lab',
        'Category: Accessories',
        'Case: Round minimalist bezel',
        'Color: Matte Dark Charcoal',
        'Display: Analog time markers'
      ],
      price: 5999,
      quantity: 12,
      sku: 'ACC-WTC-005',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-14T16:00:00.000Z',
      updatedAt: '2026-01-14T16:00:00.000Z'
    },
    {
      id: 'sample_06',
      title: 'Cotton T-Shirt',
      generatedTitle: 'Cotton T-Shirt',
      brand: 'Basic Thread',
      category: 'Clothing',
      customCategory: '',
      imageSrc: createSampleSVG('Cotton T-Shirt', SAMPLE_ICONS.shirt, '#047857', '#a7f3d0'),
      caption: 'a casual crewneck t-shirt on a neutral backdrop',
      visualAttributes: {
        category: { value: 'Clothing', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Forest Green', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Classic crew neckline', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Soft knit appearance', confidence: 'low', source: 'sample seed' }
      },
      description: 'The essential Cotton T-Shirt by Basic Thread offers everyday versatility and breathable comfort. Finished with a ribbed crew neckline and durable stitching, it is an indispensable staple for layering.\n\nPlease note: Sizing guide and fabric density should be entered based on physical garment tags.',
      features: [
        'Brand: Basic Thread',
        'Category: Clothing',
        'Silhouette: Classic crewneck short sleeve',
        'Color: Forest Green',
        'Pattern: Solid visual finish'
      ],
      price: 899,
      quantity: 60,
      sku: 'CLO-TEE-006',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-15T11:45:00.000Z',
      updatedAt: '2026-01-15T11:45:00.000Z'
    },
    {
      id: 'sample_07',
      title: 'Running Shoes',
      generatedTitle: 'Running Shoes',
      brand: 'AeroPulse',
      category: 'Footwear',
      customCategory: '',
      imageSrc: createSampleSVG('Running Shoes', SAMPLE_ICONS.sneaker, '#ea580c', '#fed7aa'),
      caption: 'athletic running shoes with lightweight sole profile',
      visualAttributes: {
        category: { value: 'Footwear', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Bright Orange', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Athletic running silhouette with contoured sole', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Graphic / Printed', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Breathable mesh texture', confidence: 'medium', source: 'sample seed' }
      },
      description: 'Engineered for energy and agility, AeroPulse Running Shoes feature an athletic contour and dynamic color accents. The lightweight sole profile supports daily walks, jogs, and active workouts with visual flair.\n\nPlease note: Confirm cushioning technology and weight specifications prior to customer release.',
      features: [
        'Brand: AeroPulse',
        'Category: Footwear',
        'Profile: Contoured athletic runner',
        'Color: Vibrant Orange & Charcoal contrast',
        'Upper: Breathable mesh visual finish'
      ],
      price: 4599,
      quantity: 25,
      sku: 'FTW-RUN-007',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-16T08:15:00.000Z',
      updatedAt: '2026-01-16T08:15:00.000Z'
    },
    {
      id: 'sample_08',
      title: 'Printed Scarf',
      generatedTitle: 'Printed Scarf',
      brand: 'Silk & Sand',
      category: 'Accessories',
      customCategory: '',
      imageSrc: createSampleSVG('Printed Scarf', SAMPLE_ICONS.dress, '#4338ca', '#c7d2fe'),
      caption: 'a lightweight printed rectangular scarf neatly draped',
      visualAttributes: {
        category: { value: 'Accessories', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Royal Blue', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Draped rectangular wrap', confidence: 'medium', source: 'sample seed' },
        pattern: { value: 'Printed visual pattern', confidence: 'high', source: 'sample seed' },
        visible_texture: { value: 'Smooth woven appearance', confidence: 'low', source: 'sample seed' }
      },
      description: 'Add an artistic flourish with the Printed Scarf from Silk & Sand. Featuring intricate visual prints in radiant royal blue tones, this lightweight scarf wraps comfortably for seasonal warmth and styling versatility.\n\nPlease note: Check precise fabric blend and dimension measurements before publishing.',
      features: [
        'Brand: Silk & Sand',
        'Category: Accessories',
        'Visual Design: Detailed print arrangement',
        'Dominant Color: Royal Blue with soft highlights',
        'Versatility: Multipurpose wrap and drape styling'
      ],
      price: 799,
      quantity: 50,
      sku: 'ACC-SCF-008',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-17T13:30:00.000Z',
      updatedAt: '2026-01-17T13:30:00.000Z'
    },
    {
      id: 'sample_09',
      title: 'Denim Jacket',
      generatedTitle: 'Denim Jacket',
      brand: 'Heritage Indigo',
      category: 'Clothing',
      customCategory: '',
      imageSrc: createSampleSVG('Denim Jacket', SAMPLE_ICONS.shirt, '#1d4ed8', '#bfdbfe'),
      caption: 'a classic blue denim jacket with metal buttons and flap pockets',
      visualAttributes: {
        category: { value: 'Clothing', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Navy Blue', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Structured outerwear silhouette', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Visible denim weave texture', confidence: 'medium', source: 'sample seed' }
      },
      description: 'A rugged classic crafted for longevity, the Denim Jacket by Heritage Indigo offers a structured trucker profile with buttoned chest flaps and contrast stitching. A dependable layer for all seasons.\n\nPlease note: Add denim weight (oz) and fit guide based on your inventory.',
      features: [
        'Brand: Heritage Indigo',
        'Category: Clothing',
        'Cut: Structured trucker jacket silhouette',
        'Color: Deep Indigo Navy Blue',
        'Hardware: Metallic front button closure'
      ],
      price: 3299,
      quantity: 18,
      sku: 'CLO-JCK-009',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-18T15:10:00.000Z',
      updatedAt: '2026-01-18T15:10:00.000Z'
    },
    {
      id: 'sample_010',
      title: 'Everyday Backpack',
      generatedTitle: 'Everyday Backpack',
      brand: 'Urban Trek',
      category: 'Bags',
      customCategory: '',
      imageSrc: createSampleSVG('Everyday Backpack', SAMPLE_ICONS.backpack, '#1e293b', '#94a3b8'),
      caption: 'a black multi-compartment travel backpack on display',
      visualAttributes: {
        category: { value: 'Bags', confidence: 'high', source: 'sample seed' },
        main_color: { value: 'Black', confidence: 'high', source: 'sample seed' },
        shape_style: { value: 'Ergonomic backpack with shoulder straps', confidence: 'high', source: 'sample seed' },
        pattern: { value: 'Solid / Plain', confidence: 'medium', source: 'sample seed' },
        visible_texture: { value: 'Canvas-like matte texture', confidence: 'low', source: 'sample seed' }
      },
      description: 'The Everyday Backpack by Urban Trek is built for modern commuting and weekend travels. Featuring ergonomic padded straps, dual water-bottle side pockets, and durable matte finish construction.\n\nPlease note: Specify laptop sleeve dimensions and volume capacity in liters before listing.',
      features: [
        'Brand: Urban Trek',
        'Category: Bags',
        'Silhouette: Ergonomic dual-strap backpack',
        'Color: Charcoal Black',
        'Organization: Multi-compartment configuration'
      ],
      price: 2799,
      quantity: 22,
      sku: 'BAG-BCK-010',
      status: 'saved',
      isSample: true,
      createdAt: '2026-01-19T17:00:00.000Z',
      updatedAt: '2026-01-19T17:00:00.000Z'
    }
  ];

  async function seedInitialCatalogueIfEmpty() {
    const isSeeded = localStorage.getItem(SEEDED_KEY);
    const existing = await db.getAll();
    if (!isSeeded && existing.length === 0) {
      console.log('Seeding initial 10 sample products...');
      for (const sample of INITIAL_10_SAMPLES) {
        await db.put(sample);
      }
      localStorage.setItem(SEEDED_KEY, 'true');
    }
  }

  // =========================================================================
  // DOM REFERENCES
  // =========================================================================
  const dom = {
    // Views
    viewSignin: document.getElementById('view-signin'),
    viewCatalogue: document.getElementById('view-catalogue'),
    viewEditor: document.getElementById('view-editor'),
    appContainer: document.getElementById('app-container'),

    // Signin
    signinForm: document.getElementById('signin-form'),
    signinUsername: document.getElementById('signin-username'),
    signinPassword: document.getElementById('signin-password'),
    signinError: document.getElementById('signin-error'),
    btnSignout: document.getElementById('btn-signout'),
    navBrandHome: document.getElementById('nav-brand-home'),

    // Header Status
    backendStatusIndicator: document.getElementById('backend-status-indicator'),
    globalToast: document.getElementById('global-toast'),

    // Catalogue
    btnAddProduct: document.getElementById('btn-add-product'),
    productGrid: document.getElementById('product-grid'),
    catalogueEmptyState: document.getElementById('catalogue-empty-state'),
    catalogueSearchInput: document.getElementById('catalogue-search-input'),
    catalogueCategoryFilter: document.getElementById('catalogue-category-filter'),
    btnResetCatalogue: document.getElementById('btn-reset-catalogue'),
    btnEmptyAdd: document.getElementById('btn-empty-add'),
    btnEmptySeed: document.getElementById('btn-empty-seed'),

    // Editor Header
    btnBackToCatalogue: document.getElementById('btn-back-to-catalogue'),
    editorHeading: document.getElementById('editor-heading'),
    productStatusPill: document.getElementById('product-status-pill'),
    btnSaveDraft: document.getElementById('btn-save-draft'),
    btnSaveProduct: document.getElementById('btn-save-product'),

    // Editor Left Inputs
    imageDropzone: document.getElementById('image-dropzone'),
    imageFileInput: document.getElementById('image-file-input'),
    dropzonePrompt: document.getElementById('dropzone-prompt'),
    dropzonePreviewContainer: document.getElementById('dropzone-preview-container'),
    imagePreview: document.getElementById('image-preview'),
    btnReplaceImage: document.getElementById('btn-replace-image'),
    btnClearImage: document.getElementById('btn-clear-image'),

    inputUserTitle: document.getElementById('input-user-title'),
    inputUserBrand: document.getElementById('input-user-brand'),
    selectUserCategory: document.getElementById('select-user-category'),
    customCategoryGroup: document.getElementById('custom-category-group'),
    inputCustomCategory: document.getElementById('input-custom-category'),

    btnGenerateAI: document.getElementById('btn-generate-ai'),
    aiGenerationLoading: document.getElementById('ai-generation-loading'),
    generationStatusText: document.getElementById('generation-status-text'),
    aiGenerationError: document.getElementById('ai-generation-error'),

    inputPrice: document.getElementById('input-price'),
    inputQuantity: document.getElementById('input-quantity'),
    inputSku: document.getElementById('input-sku'),

    // Editor Right (4 Required Sections)
    outputTitle: document.getElementById('output-title'),

    attrCategory: document.getElementById('attr-category'),
    confCategory: document.getElementById('conf-category'),
    attrColor: document.getElementById('attr-color'),
    confColor: document.getElementById('conf-color'),
    attrShape: document.getElementById('attr-shape'),
    confShape: document.getElementById('conf-shape'),
    attrPattern: document.getElementById('attr-pattern'),
    confPattern: document.getElementById('conf-pattern'),
    attrTexture: document.getElementById('attr-texture'),
    confTexture: document.getElementById('conf-texture'),

    outputDescription: document.getElementById('output-description'),

    btnAddFeature: document.getElementById('btn-add-feature'),
    featuresContainer: document.getElementById('features-container'),

    // Diagnostics
    diagCaption: document.getElementById('diag-caption'),
    diagDevice: document.getElementById('diag-device'),
    diagUncertaintyBox: document.getElementById('diag-uncertainty-box')
  };

  // =========================================================================
  // VIEW NAVIGATION & SESSION MANAGEMENT
  // =========================================================================
  function checkSession() {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  }

  function setSession(active) {
    if (active) {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function switchView(viewName) {
    if (viewName !== 'signin' && !checkSession()) {
      switchView('signin');
      return;
    }

    state.currentView = viewName;

    // Toggle active view elements
    if (viewName === 'signin') {
      dom.viewSignin.classList.remove('hidden');
      dom.appContainer.classList.add('hidden');
    } else {
      dom.viewSignin.classList.add('hidden');
      dom.appContainer.classList.remove('hidden');

      if (viewName === 'catalogue') {
        dom.viewCatalogue.classList.remove('hidden');
        dom.viewEditor.classList.add('hidden');
        renderCatalogue();
      } else if (viewName === 'editor') {
        dom.viewCatalogue.classList.add('hidden');
        dom.viewEditor.classList.remove('hidden');
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message, duration = 3000) {
    dom.globalToast.textContent = message;
    dom.globalToast.classList.remove('hidden');
    setTimeout(() => {
      dom.globalToast.classList.add('hidden');
    }, duration);
  }

  // =========================================================================
  // HEALTH CHECK POLLING
  // =========================================================================
  async function pollBackendHealth() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        state.backendStatus = {
          online: true,
          modelLoaded: !!data.model_loaded,
          device: data.device || 'cpu'
        };
      } else {
        state.backendStatus = { online: false, modelLoaded: false, device: 'error' };
      }
    } catch (err) {
      state.backendStatus = { online: false, modelLoaded: false, device: 'offline' };
    }
    updateBackendStatusUI();
  }

  function updateBackendStatusUI() {
    const pill = dom.backendStatusIndicator;
    pill.innerHTML = '';

    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const label = document.createElement('span');
    label.className = 'status-label';

    if (!state.backendStatus.online) {
      dot.classList.add('dot-offline');
      label.textContent = 'Backend Offline';
      pill.title = 'FastAPI server is not reachable at 127.0.0.1:8000';
    } else if (state.backendStatus.modelLoaded) {
      dot.classList.add('dot-ready');
      label.textContent = `AI Ready (${state.backendStatus.device.toUpperCase()})`;
      pill.title = 'BLIP model is loaded in memory and ready for inference';
    } else {
      dot.classList.add('dot-connecting');
      label.textContent = 'Loading AI Model...';
      pill.title = 'Model weights are being loaded into memory';
    }

    pill.appendChild(dot);
    pill.appendChild(label);
  }

  // =========================================================================
  // PAGE 1: SIGN-IN LOGIC
  // =========================================================================
  dom.signinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = dom.signinUsername.value.trim();
    const pass = dom.signinPassword.value;

    if (user === DEMO_USER && pass === DEMO_PASS) {
      dom.signinError.classList.add('hidden');
      dom.signinError.textContent = '';
      setSession(true);
      showToast('Signed in successfully as Merchant Admin');
      switchView('catalogue');
    } else {
      dom.signinError.textContent = 'Invalid credentials. Please enter admin and admin@124.';
      dom.signinError.classList.remove('hidden');
    }
  });

  dom.btnSignout.addEventListener('click', () => {
    setSession(false);
    showToast('Signed out of ShopAI');
    switchView('signin');
  });

  dom.navBrandHome.addEventListener('click', () => {
    if (state.currentView === 'editor' && state.isDirty) {
      if (!confirm('You have unsaved changes. Return to catalogue without saving?')) {
        return;
      }
    }
    switchView('catalogue');
  });

  // =========================================================================
  // PAGE 2: CATALOGUE LOGIC
  // =========================================================================
  async function loadProductsFromDB() {
    state.products = await db.getAll();
    // Sort descending by updatedAt
    state.products.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  async function renderCatalogue() {
    await loadProductsFromDB();

    const searchTerm = dom.catalogueSearchInput.value.toLowerCase().trim();
    const categoryFilter = dom.catalogueCategoryFilter.value;

    const filtered = state.products.filter(p => {
      const matchSearch = !searchTerm ||
        (p.title && p.title.toLowerCase().includes(searchTerm)) ||
        (p.sku && p.sku.toLowerCase().includes(searchTerm)) ||
        (p.category && p.category.toLowerCase().includes(searchTerm)) ||
        (p.brand && p.brand.toLowerCase().includes(searchTerm));

      const matchCategory = (categoryFilter === 'all') || (p.category === categoryFilter);
      return matchSearch && matchCategory;
    });

    dom.productGrid.innerHTML = '';

    if (filtered.length === 0) {
      dom.productGrid.classList.add('hidden');
      dom.catalogueEmptyState.classList.remove('hidden');
      return;
    }

    dom.catalogueEmptyState.classList.add('hidden');
    dom.productGrid.classList.remove('hidden');

    filtered.forEach(product => {
      const card = createProductCardElement(product);
      dom.productGrid.appendChild(card);
    });
  }

  function createProductCardElement(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `Product: ${product.title}`);

    // Thumbnail container
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'product-card-thumb-wrap';

    const img = document.createElement('img');
    img.className = 'product-card-thumb';
    img.alt = product.title || 'Product Thumbnail';

    if (product.imageBlob) {
      const objUrl = URL.createObjectURL(product.imageBlob);
      img.src = objUrl;
    } else if (product.imageSrc) {
      img.src = product.imageSrc;
    } else {
      img.src = createSampleSVG(product.title || 'Product', SAMPLE_ICONS.shirt, '#475569', '#cbd5e1');
    }

    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'product-card-badges';

    // Status badge
    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${product.status === 'draft' ? 'badge-draft' : 'badge-saved'}`;
    statusBadge.textContent = product.status === 'draft' ? 'Draft' : 'Saved';
    badgesContainer.appendChild(statusBadge);

    if (product.isSample) {
      const sampleBadge = document.createElement('span');
      sampleBadge.className = 'badge badge-sample';
      sampleBadge.textContent = 'Sample';
      badgesContainer.appendChild(sampleBadge);
    }

    thumbWrap.appendChild(img);
    thumbWrap.appendChild(badgesContainer);

    // Card Body
    const body = document.createElement('div');
    body.className = 'product-card-body';

    if (product.brand) {
      const brand = document.createElement('div');
      brand.className = 'product-card-brand';
      brand.textContent = product.brand;
      body.appendChild(brand);
    }

    const title = document.createElement('h3');
    title.className = 'product-card-title';
    title.textContent = product.title || 'Untitled Product';
    body.appendChild(title);

    const category = document.createElement('div');
    category.className = 'product-card-category';
    category.textContent = product.category || 'Uncategorized';
    body.appendChild(category);

    const footer = document.createElement('div');
    footer.className = 'product-card-footer';

    const price = document.createElement('div');
    price.className = 'product-card-price';
    price.textContent = product.price !== null && product.price !== undefined && !isNaN(product.price)
      ? inrFormatter.format(product.price)
      : '₹ —';

    const sku = document.createElement('div');
    sku.className = 'product-card-sku';
    sku.textContent = product.sku ? `SKU: ${product.sku}` : '';

    footer.appendChild(price);
    footer.appendChild(sku);
    body.appendChild(footer);

    card.appendChild(thumbWrap);
    card.appendChild(body);

    // Click handler to open edit view
    card.addEventListener('click', () => openEditorForProduct(product.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditorForProduct(product.id);
      }
    });

    return card;
  }

  // Catalogue Toolbar Events
  dom.catalogueSearchInput.addEventListener('input', () => renderCatalogue());
  dom.catalogueCategoryFilter.addEventListener('change', () => renderCatalogue());

  dom.btnResetCatalogue.addEventListener('click', async () => {
    if (confirm('Reset catalogue to the original 10 sample products? Any user-created items will be replaced.')) {
      await db.clear();
      for (const sample of INITIAL_10_SAMPLES) {
        await db.put(sample);
      }
      localStorage.setItem(SEEDED_KEY, 'true');
      showToast('Catalogue reset to 10 sample products');
      renderCatalogue();
    }
  });

  dom.btnEmptySeed.addEventListener('click', async () => {
    for (const sample of INITIAL_10_SAMPLES) {
      await db.put(sample);
    }
    localStorage.setItem(SEEDED_KEY, 'true');
    showToast('Restored 10 sample products');
    renderCatalogue();
  });

  dom.btnAddProduct.addEventListener('click', () => openEditorForNew());
  dom.btnEmptyAdd.addEventListener('click', () => openEditorForNew());

  // =========================================================================
  // PAGE 3: ADD / EDIT PRODUCT LOGIC
  // =========================================================================
  function resetEditorForm() {
    state.currentProductId = null;
    state.currentImageBlob = null;
    if (state.currentImageObjectURL) {
      URL.revokeObjectURL(state.currentImageObjectURL);
      state.currentImageObjectURL = null;
    }
    state.isDirty = false;
    state.hasGeneratedContent = false;

    // Reset UI fields
    dom.imageFileInput.value = '';
    dom.dropzonePrompt.classList.remove('hidden');
    dom.dropzonePreviewContainer.classList.add('hidden');
    dom.imagePreview.src = '';

    dom.inputUserTitle.value = '';
    dom.inputUserBrand.value = '';
    dom.selectUserCategory.value = '';
    dom.customCategoryGroup.classList.add('hidden');
    dom.inputCustomCategory.value = '';

    dom.inputPrice.value = '';
    dom.inputQuantity.value = '';
    dom.inputSku.value = '';

    dom.outputTitle.value = '';
    dom.attrCategory.value = '';
    dom.attrColor.value = '';
    dom.attrShape.value = '';
    dom.attrPattern.value = '';
    dom.attrTexture.value = '';
    dom.outputDescription.value = '';

    setConfidencePill(dom.confCategory, 'Not detected', 'uncertain');
    setConfidencePill(dom.confColor, 'Not detected', 'uncertain');
    setConfidencePill(dom.confShape, 'Not detected', 'uncertain');
    setConfidencePill(dom.confPattern, 'Not detected', 'uncertain');
    setConfidencePill(dom.confTexture, 'Not detected', 'uncertain');

    dom.featuresContainer.innerHTML = '';
    dom.diagCaption.textContent = '—';
    dom.diagDevice.textContent = '—';
    dom.diagUncertaintyBox.innerHTML = '';

    dom.aiGenerationError.classList.add('hidden');
    dom.aiGenerationError.textContent = '';
    dom.aiGenerationLoading.classList.add('hidden');
  }

  function setConfidencePill(element, label, confLevel) {
    element.textContent = label;
    element.className = 'conf-pill';
    if (confLevel === 'high') element.classList.add('high');
    else if (confLevel === 'medium') element.classList.add('medium');
    else if (confLevel === 'low') element.classList.add('low');
    else element.classList.add('uncertain');
  }

  function openEditorForNew() {
    resetEditorForm();
    dom.editorHeading.textContent = 'Add New Product';
    dom.productStatusPill.textContent = 'Draft';
    dom.productStatusPill.className = 'badge badge-draft';
    switchView('editor');
  }

  async function openEditorForProduct(id) {
    resetEditorForm();
    const product = await db.getById(id);
    if (!product) {
      showToast('Product not found in storage');
      switchView('catalogue');
      return;
    }

    state.currentProductId = product.id;
    dom.editorHeading.textContent = `Edit: ${product.title || 'Product'}`;

    const isDraft = product.status === 'draft';
    dom.productStatusPill.textContent = isDraft ? 'Draft' : 'Saved';
    dom.productStatusPill.className = `badge ${isDraft ? 'badge-draft' : 'badge-saved'}`;

    // Populate Left info
    dom.inputUserTitle.value = product.title || '';
    dom.inputUserBrand.value = product.brand || '';

    if (product.category) {
      const hasOption = Array.from(dom.selectUserCategory.options).some(o => o.value === product.category);
      if (hasOption) {
        dom.selectUserCategory.value = product.category;
      } else {
        dom.selectUserCategory.value = 'Other';
        dom.customCategoryGroup.classList.remove('hidden');
        dom.inputCustomCategory.value = product.category;
      }
    }

    dom.inputPrice.value = (product.price !== null && product.price !== undefined) ? product.price : '';
    dom.inputQuantity.value = (product.quantity !== null && product.quantity !== undefined) ? product.quantity : '';
    dom.inputSku.value = product.sku || '';

    // Populate Image
    if (product.imageBlob) {
      state.currentImageBlob = product.imageBlob;
      state.currentImageObjectURL = URL.createObjectURL(product.imageBlob);
      dom.imagePreview.src = state.currentImageObjectURL;
      dom.dropzonePrompt.classList.add('hidden');
      dom.dropzonePreviewContainer.classList.remove('hidden');
    } else if (product.imageSrc) {
      dom.imagePreview.src = product.imageSrc;
      dom.dropzonePrompt.classList.add('hidden');
      dom.dropzonePreviewContainer.classList.remove('hidden');
    }

    // Populate Generated 4 Sections
    dom.outputTitle.value = product.generatedTitle || product.title || '';

    const attrs = product.visualAttributes || {};
    dom.attrCategory.value = (attrs.category && attrs.category.value) || product.category || '';
    setConfidencePill(dom.confCategory, (attrs.category && attrs.category.source) || 'Saved record', (attrs.category && attrs.category.confidence) || 'medium');

    dom.attrColor.value = (attrs.main_color && attrs.main_color.value) || '';
    setConfidencePill(dom.confColor, (attrs.main_color && attrs.main_color.source) || 'Saved record', (attrs.main_color && attrs.main_color.confidence) || 'medium');

    dom.attrShape.value = (attrs.shape_style && attrs.shape_style.value) || '';
    setConfidencePill(dom.confShape, (attrs.shape_style && attrs.shape_style.source) || 'Saved record', (attrs.shape_style && attrs.shape_style.confidence) || 'low');

    dom.attrPattern.value = (attrs.pattern && attrs.pattern.value) || '';
    setConfidencePill(dom.confPattern, (attrs.pattern && attrs.pattern.source) || 'Saved record', (attrs.pattern && attrs.pattern.confidence) || 'low');

    dom.attrTexture.value = (attrs.visible_texture && attrs.visible_texture.value) || '';
    setConfidencePill(dom.confTexture, (attrs.visible_texture && attrs.visible_texture.source) || 'Saved record', (attrs.visible_texture && attrs.visible_texture.confidence) || 'low');

    dom.outputDescription.value = product.description || '';

    // Features
    dom.featuresContainer.innerHTML = '';
    if (Array.isArray(product.features) && product.features.length > 0) {
      product.features.forEach(feat => addFeatureRow(feat));
    }

    // Diagnostics
    if (product.caption) {
      dom.diagCaption.textContent = product.caption;
    }

    state.isDirty = false;
    switchView('editor');
  }

  // Feature Bullet Point Builder
  function addFeatureRow(text = '') {
    const row = document.createElement('div');
    row.className = 'feature-item-row';

    const bullet = document.createElement('span');
    bullet.className = 'feature-bullet-icon';
    bullet.textContent = '•';
    bullet.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = 'Feature point...';
    input.value = text;
    input.addEventListener('input', () => { state.isDirty = true; });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-remove-feature';
    btnRemove.title = 'Remove this feature';
    btnRemove.setAttribute('aria-label', 'Remove feature');
    btnRemove.innerHTML = '&times;';
    btnRemove.addEventListener('click', () => {
      row.remove();
      state.isDirty = true;
    });

    row.appendChild(bullet);
    row.appendChild(input);
    row.appendChild(btnRemove);
    dom.featuresContainer.appendChild(row);

    state.isDirty = true;
  }

  dom.btnAddFeature.addEventListener('click', () => addFeatureRow(''));

  // Dirty Flag Listeners on Form Inputs
  [
    dom.inputUserTitle,
    dom.inputUserBrand,
    dom.selectUserCategory,
    dom.inputCustomCategory,
    dom.inputPrice,
    dom.inputQuantity,
    dom.inputSku,
    dom.outputTitle,
    dom.attrCategory,
    dom.attrColor,
    dom.attrShape,
    dom.attrPattern,
    dom.attrTexture,
    dom.outputDescription
  ].forEach(el => {
    el.addEventListener('input', () => { state.isDirty = true; });
  });

  // Category Selector Change
  dom.selectUserCategory.addEventListener('change', () => {
    if (dom.selectUserCategory.value === 'Other') {
      dom.customCategoryGroup.classList.remove('hidden');
    } else {
      dom.customCategoryGroup.classList.add('hidden');
    }
    state.isDirty = true;
  });

  // Image Upload & Dropzone Handling
  dom.imageDropzone.addEventListener('click', (e) => {
    if (e.target !== dom.btnReplaceImage && e.target !== dom.btnClearImage) {
      dom.imageFileInput.click();
    }
  });

  dom.imageDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.imageFileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach(name => {
    dom.imageDropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.imageDropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dom.imageDropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.imageDropzone.classList.remove('drag-over');
    });
  });

  dom.imageDropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleImageFile(files[0]);
    }
  });

  dom.imageFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleImageFile(e.target.files[0]);
    }
  });

  dom.btnReplaceImage.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.imageFileInput.click();
  });

  dom.btnClearImage.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelectedImage();
  });

  function clearSelectedImage() {
    state.currentImageBlob = null;
    if (state.currentImageObjectURL) {
      URL.revokeObjectURL(state.currentImageObjectURL);
      state.currentImageObjectURL = null;
    }
    dom.imageFileInput.value = '';
    dom.imagePreview.src = '';
    dom.dropzonePrompt.classList.remove('hidden');
    dom.dropzonePreviewContainer.classList.add('hidden');
    state.isDirty = true;
  }

  function handleImageFile(file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert('Please select a valid JPG, PNG, or WEBP image file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert(`Image file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 10 MB.`);
      return;
    }

    state.currentImageBlob = file;
    if (state.currentImageObjectURL) {
      URL.revokeObjectURL(state.currentImageObjectURL);
    }
    state.currentImageObjectURL = URL.createObjectURL(file);
    dom.imagePreview.src = state.currentImageObjectURL;
    dom.dropzonePrompt.classList.add('hidden');
    dom.dropzonePreviewContainer.classList.remove('hidden');
    state.isDirty = true;
  }

  // Back Navigation Guard
  dom.btnBackToCatalogue.addEventListener('click', () => {
    if (state.isDirty) {
      if (!confirm('You have unsaved changes. Discard and return to catalogue?')) {
        return;
      }
    }
    switchView('catalogue');
  });

  // =========================================================================
  // AI GENERATION DISPATCH
  // =========================================================================
  dom.btnGenerateAI.addEventListener('click', async () => {
    // 1. Validate image presence
    if (!state.currentImageBlob && !dom.imagePreview.src) {
      dom.aiGenerationError.textContent = 'Please upload a product image first before clicking Generate.';
      dom.aiGenerationError.classList.remove('hidden');
      return;
    }

    // 2. Warn before replacing edited sections
    if (state.hasGeneratedContent || dom.outputDescription.value.trim().length > 0) {
      if (!confirm('Regenerating will replace your current generated title, attributes, description, and features. Continue?')) {
        return;
      }
    }

    // Prepare FormData
    const formData = new FormData();
    if (state.currentImageBlob) {
      formData.append('image', state.currentImageBlob, state.currentImageBlob.name || 'product.jpg');
    } else {
      // If editing an existing sample product with SVG/canvas data
      try {
        const resp = await fetch(dom.imagePreview.src);
        const blob = await resp.blob();
        formData.append('image', blob, 'sample_image.png');
      } catch (err) {
        dom.aiGenerationError.textContent = 'Could not read image for AI analysis. Please upload an image file.';
        dom.aiGenerationError.classList.remove('hidden');
        return;
      }
    }

    const titleHint = dom.inputUserTitle.value.trim();
    if (titleHint) formData.append('title', titleHint);

    const brandHint = dom.inputUserBrand.value.trim();
    if (brandHint) formData.append('brand', brandHint);

    let categoryHint = dom.selectUserCategory.value;
    if (categoryHint === 'Other' && dom.inputCustomCategory.value.trim()) {
      categoryHint = dom.inputCustomCategory.value.trim();
    }
    if (categoryHint) formData.append('category', categoryHint);

    // Set UI to loading state
    dom.btnGenerateAI.disabled = true;
    dom.aiGenerationError.classList.add('hidden');
    dom.aiGenerationError.textContent = '';
    dom.aiGenerationLoading.classList.remove('hidden');
    dom.generationStatusText.textContent = 'Analyzing image with Salesforce BLIP...';

    try {
      const response = await fetch('/api/generate-description', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errMessage = `Error ${response.status}: Failed to generate product description.`;
        try {
          const errData = await response.json();
          if (errData && errData.detail) errMessage = errData.detail;
        } catch (_) { }

        if (response.status === 503) {
          errMessage = 'The AI model is still loading or currently unavailable. Please check backend status and retry in a moment.';
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      populateGeneratedData(data);
      state.hasGeneratedContent = true;
      state.isDirty = true;
      showToast('AI analysis completed successfully!');
    } catch (err) {
      console.error('AI Generation failed:', err);
      dom.aiGenerationError.textContent = err.message || 'Failed to connect to AI backend. Make sure the server is running.';
      dom.aiGenerationError.classList.remove('hidden');
    } finally {
      dom.btnGenerateAI.disabled = false;
      dom.aiGenerationLoading.classList.add('hidden');
    }
  });

  function populateGeneratedData(data) {
    // 1. Product Title
    dom.outputTitle.value = data.product_title || '';

    // 2. Visual Attributes
    const attrs = data.visual_attributes || {};

    if (attrs.category) {
      dom.attrCategory.value = attrs.category.value || '';
      setConfidencePill(dom.confCategory, `${attrs.category.confidence} • ${attrs.category.source}`, attrs.category.confidence);
    }
    if (attrs.main_color) {
      dom.attrColor.value = attrs.main_color.value || '';
      setConfidencePill(dom.confColor, `${attrs.main_color.confidence} • ${attrs.main_color.source}`, attrs.main_color.confidence);
    }
    if (attrs.shape_style) {
      dom.attrShape.value = attrs.shape_style.value || '';
      setConfidencePill(dom.confShape, `${attrs.shape_style.confidence} • ${attrs.shape_style.source}`, attrs.shape_style.confidence);
    }
    if (attrs.pattern) {
      dom.attrPattern.value = attrs.pattern.value || '';
      setConfidencePill(dom.confPattern, `${attrs.pattern.confidence} • ${attrs.pattern.source}`, attrs.pattern.confidence);
    }
    if (attrs.visible_texture) {
      dom.attrTexture.value = attrs.visible_texture.value || '';
      setConfidencePill(dom.confTexture, `${attrs.visible_texture.confidence} • ${attrs.visible_texture.source}`, attrs.visible_texture.confidence);
    }

    // 3. Full Description
    dom.outputDescription.value = data.full_description || '';

    // 4. Key Features
    dom.featuresContainer.innerHTML = '';
    if (Array.isArray(data.key_features) && data.key_features.length > 0) {
      data.key_features.forEach(feat => addFeatureRow(feat));
    } else {
      addFeatureRow('Add custom product feature here');
    }

    // Diagnostic information
    dom.diagCaption.textContent = data.caption || '—';
    dom.diagDevice.textContent = state.backendStatus.device ? state.backendStatus.device.toUpperCase() : 'CPU';

    dom.diagUncertaintyBox.innerHTML = '';
    if (Array.isArray(data.uncertainty_notes)) {
      data.uncertainty_notes.forEach(note => {
        const p = document.createElement('p');
        p.className = 'text-muted';
        p.textContent = `• ${note}`;
        dom.diagUncertaintyBox.appendChild(p);
      });
    }
  }

  // =========================================================================
  // SAVING PRODUCT (DRAFT OR SAVED)
  // =========================================================================
  dom.btnSaveDraft.addEventListener('click', () => saveProductRecord('draft'));
  dom.btnSaveProduct.addEventListener('click', () => saveProductRecord('saved'));

  async function saveProductRecord(targetStatus) {
    // 1. Determine title
    let finalTitle = dom.outputTitle.value.trim() || dom.inputUserTitle.value.trim();
    if (!finalTitle) {
      alert('Please provide or generate a Product Title before saving.');
      dom.outputTitle.focus();
      return;
    }

    // 2. Determine category
    let finalCategory = dom.attrCategory.value.trim() || dom.selectUserCategory.value;
    if (dom.selectUserCategory.value === 'Other' && dom.inputCustomCategory.value.trim()) {
      finalCategory = dom.inputCustomCategory.value.trim();
    }
    if (!finalCategory) finalCategory = 'Other';

    // 3. Parse inventory numbers
    const priceRaw = parseFloat(dom.inputPrice.value);
    const priceVal = (!isNaN(priceRaw) && priceRaw >= 0) ? priceRaw : null;

    const qtyRaw = parseInt(dom.inputQuantity.value, 10);
    const qtyVal = (!isNaN(qtyRaw) && qtyRaw >= 0) ? qtyRaw : null;

    const skuVal = dom.inputSku.value.trim();

    // 4. Collect features
    const featureInputs = dom.featuresContainer.querySelectorAll('input.form-control');
    const featuresList = [];
    featureInputs.forEach(inp => {
      const v = inp.value.trim();
      if (v) featuresList.push(v);
    });

    // 5. Build structured Visual Attributes object
    const visualAttrs = {
      category: { value: dom.attrCategory.value.trim() || 'Other', confidence: 'user-confirmed', source: 'merchant input' },
      main_color: { value: dom.attrColor.value.trim() || 'Not confidently detected', confidence: 'user-confirmed', source: 'merchant input' },
      shape_style: { value: dom.attrShape.value.trim() || 'Not confidently detected', confidence: 'user-confirmed', source: 'merchant input' },
      pattern: { value: dom.attrPattern.value.trim() || 'Not confidently detected', confidence: 'user-confirmed', source: 'merchant input' },
      visible_texture: { value: dom.attrTexture.value.trim() || 'Not confidently detected', confidence: 'user-confirmed', source: 'merchant input' }
    };

    const nowISO = new Date().toISOString();
    const isNew = !state.currentProductId;
    const recordId = isNew ? `prod_${Date.now()}` : state.currentProductId;

    // Existing record fallback
    let existingRecord = null;
    if (!isNew) {
      existingRecord = await db.getById(recordId);
    }

    const record = {
      id: recordId,
      title: finalTitle,
      generatedTitle: dom.outputTitle.value.trim(),
      brand: dom.inputUserBrand.value.trim(),
      category: finalCategory,
      customCategory: dom.inputCustomCategory.value.trim(),
      imageBlob: state.currentImageBlob || (existingRecord ? existingRecord.imageBlob : null),
      imageSrc: (!state.currentImageBlob && existingRecord) ? existingRecord.imageSrc : null,
      caption: dom.diagCaption.textContent !== '—' ? dom.diagCaption.textContent : (existingRecord ? existingRecord.caption : ''),
      visualAttributes: visualAttrs,
      description: dom.outputDescription.value.trim(),
      features: featuresList,
      price: priceVal,
      quantity: qtyVal,
      sku: skuVal,
      status: targetStatus,
      isSample: existingRecord ? !!existingRecord.isSample : false,
      createdAt: existingRecord ? existingRecord.createdAt : nowISO,
      updatedAt: nowISO
    };

    try {
      await db.put(record);
      state.isDirty = false;
      showToast(targetStatus === 'draft' ? 'Product saved as Draft' : 'Product saved successfully!');
      switchView('catalogue');
    } catch (err) {
      console.error('Failed to save product in IndexedDB:', err);
      alert('Storage error: Failed to save product to IndexedDB.');
    }
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================
  async function initApp() {
    try {
      await db.init();
      await seedInitialCatalogueIfEmpty();
    } catch (err) {
      console.error('Database initialization error:', err);
    }

    // Health check polling
    pollBackendHealth();
    setInterval(pollBackendHealth, 15000);

    // Initial view based on session
    if (checkSession()) {
      switchView('catalogue');
    } else {
      switchView('signin');
    }
  }

  // Run on DOM content loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
