const path = require("path");
const JSONdb = require("simple-json-db");
let store = null;
let log = console;
let dbPath = null;

// Default Configuration
const defaultConfig = {
  server: {
    PORT: {
      value: 3000,
      type: "number",
      note: "Server listening port",
      placeholder: "PORT",
      min: 1,
      max: 65535,
    },

    AUTO_UPDATE_CHECK: {
      value: true,
      type: "boolean",
      note: "Enable automatic update checks",
    },

    UPDATE_CHECK_INTERVAL: {
      value: 21600000,
      min: 3600000,
      type: "number",
      unit: "ms",
      display: "hours",
      note: "Interval for checking updates",
    },

    KEEP_HISTORY: {
      value: false,
      type: "boolean",
      note: "Prevent the music history from being deleted when the server is launched.",
    },

    KEEP_LOGS: {
      value: false,
      type: "boolean",
      note: "Prevent the server log from being deleted when the server is launched.",
    },

    LOG_MEDIA_UPDATE: {
      value: false,
      type: "boolean",
      note: "Save activity change events in the log.",
    },

    MAX_LOG_SIZE: {
      value: 5 * 1024 * 1024,
      min: 1 * 1024 * 1024,
      type: "number",
      unit: "bytes",
      display: "mb",
      note: "Maximum log file size before removal",
    },

    START_TIMEOUT: {
      value: 15000,
      min: 5000,
      type: "number",
      unit: "ms",
      display: "seconds",
      note: "Server startup timeout",
      hidden: true,
    },

    MAX_RESTART_ATTEMPTS: {
      value: 5,
      min: 0,
      type: "number",
      note: "Maximum number of restart attempts on failure",
      hidden: true,
    },

    RESTART_DELAY: {
      value: 5000,
      type: "number",
      unit: "ms",
      display: "seconds",
      note: "Delay before restarting the server",
      hidden: true,
    },

    LOG_ROTATION_INTERVAL: {
      value: 15 * 60 * 1000,
      type: "number",
      unit: "ms",
      display: "minutes",
      note: "Log rotation interval",
      hidden: true,
    },

    EXPORT_ACTIVITY_FILES: {
      value: false,
      type: "boolean",
      note: "Writes current activity data to files in the userData directory.",
      path: null,
    },

    WNP_RAINMETER_SUPPORT: {
      value: false,
      type: "boolean",
      note: "Enable WNP Rainmeter support.",
    },

    WNP_OBS_SUPPORT: {
      value: false,
      type: "boolean",
      note: "Enable WNP OBS support.",
    },

    DISCORD_WEB_SUPPORT: {
      value: true,
      type: "boolean",
      note: "Enable discord web support.",
      children: "DISCORD_WEB_PORT",
    },

    DISCORD_WEB_PORT: {
      value: 1337,
      type: "number",
      placeholder: "PORT",
      min: 1,
      max: 65535,
    },
  },
};

/**
 * Synchronizes the config schema
 * Updates all fields except Value according to the default config
 */
const syncConfigSchema = (current, defaults) => {
  let updated = false;
  const synced = {};

  for (const key in defaults) {
    const defaultSchema = defaults[key];

    // If the key does not exist, add the entire default schema
    if (!(key in current)) {
      synced[key] = { ...defaultSchema };
      updated = true;
      log.info(`[Config] Added missing key: ${key}`);
      continue;
    }

    const currentItem = current[key];

    // If it's not an object or doesn't have a value field, fix the structure
    if (typeof currentItem !== "object" || !("value" in currentItem)) {
      synced[key] = {
        ...defaultSchema,
        value: currentItem, // Keep the current value
      };
      updated = true;
      log.info(`[Config] Fixed structure for: ${key}`);
      continue;
    }

    // Preserve the value, take all other fields from the default
    synced[key] = {
      ...defaultSchema,
      value: currentItem.value, // Keep the current value
    };

    // Check if there are any changes other than the value
    for (const field in defaultSchema) {
      if (field === "value") continue; // Check the value

      if (currentItem[field] !== defaultSchema[field]) {
        updated = true;
        log.info(`[Config] Updated ${key}.${field}: ${currentItem[field]} -> ${defaultSchema[field]}`);
      }
    }

    // Clear extra fields (those not default)
    for (const field in currentItem) {
      if (!(field in defaultSchema)) {
        updated = true;
        log.info(`[Config] Removed obsolete field: ${key}.${field}`);
      }
    }
  }

  // Remove keys that exist in the Store but are not in the default
  for (const key in current) {
    if (!(key in defaults)) {
      updated = true;
      log.info(`[Config] Removed obsolete key: ${key}`);
      // add to synced, so it gets deleted
    }
  }

  return { synced, updated };
};

// Config object
const config = {};

/**
 * Initializes the config system
 * @param {string} userDataPath - Electron app.getPath("userData")
 * @param {Object} logger - Logger object (optional)
 */
const initialize = (userDataPath, logger = console) => {
  if (!userDataPath) {
    throw new Error("userDataPath is required for config initialization");
  }

  // Set the logger
  log = logger;

  // Set userData path for EXPORT_ACTIVITY_FILES
  defaultConfig.server.EXPORT_ACTIVITY_FILES.path = path.join(userDataPath, "currentActivity");

  // Create the DB path and start the store
  dbPath = path.join(userDataPath, "config.json");
  store = new JSONdb(dbPath);

  log.info(`[Config] Initializing with database at: ${dbPath}`);

  // Load and synchronize the config
  initializeConfig();
};

// Initialize Config
const initializeConfig = () => {
  if (!store.has("server")) {
    // Initial setup
    log.info("[Config] First time setup - using default config");
    store.set("server", defaultConfig.server);
  } else {
    // Synchronize the current config
    log.info("[Config] Synchronizing existing config with defaults...");
    const current = store.get("server");
    const { synced, updated } = syncConfigSchema(current, defaultConfig.server);

    if (updated) {
      log.info("[Config] Schema updated - saving changes");
      store.set("server", synced);
    } else {
      log.info("[Config] Schema is up to date");
    }
  }

  // Update the config object
  updateConfigObject();
};

const flattenConfig = (schema) => Object.fromEntries(Object.entries(schema).map(([key, def]) => [key, def.value]));

// Updates the config object
const updateConfigObject = () => {
  if (!store) {
    log.warn("[Config] Store not initialized, cannot update config object");
    return;
  }

  const rawConfig = store.get("server");
  const flattened = flattenConfig(rawConfig);

  // Clear the contents of the current config object
  for (const key in config) {
    delete config[key];
  }

  // Add new values
  Object.assign(config, flattened);
};

// Get the raw config
const getRawConfig = () => {
  if (!store) {
    log.warn("[Config] Store not initialized, returning default config");
    return defaultConfig.server;
  }
  return store.get("server");
};

// Refresh Configuration
const refreshConfig = () => {
  try {
    if (!store || !dbPath) {
      throw new Error("Config not initialized. Call initialize() first.");
    }

    // Reload the Store
    store = new JSONdb(dbPath);

    // Resynchronize
    initializeConfig();
    return true;
  } catch (err) {
    log.error("[Config] Failed to refresh config:", err);

    // Use the default config in case of an error
    for (const key in config) {
      delete config[key];
    }
    Object.assign(config, flattenConfig(defaultConfig.server));

    return false;
  }
};

// Update a specific config value
const updateConfigValue = (key, value) => {
  try {
    if (!store) {
      throw new Error("Config not initialized. Call initialize() first.");
    }

    const schema = store.get("server");

    if (!schema[key]) {
      throw new Error(`Config key not found: ${key}`);
    }

    schema[key].value = value;
    store.set("server", schema);
    config[key] = value;

    log.info(`[Config] Updated ${key} = ${value}`);
    return true;
  } catch (err) {
    log.error(`[Config] Failed to update ${key}:`, err);
    return false;
  }
};

// Update the entire config (values)
const updateConfigValues = (updates) => {
  try {
    if (!store) {
      throw new Error("Config not initialized. Call initialize() first.");
    }

    const schema = store.get("server");
    let changed = false;

    for (const [key, value] of Object.entries(updates)) {
      if (!schema[key]) {
        log.warn(`[Config] Ignoring unknown key: ${key}`);
        continue;
      }

      if (schema[key].value !== value) {
        schema[key].value = value;
        config[key] = value;
        changed = true;
        log.info(`[Config] Updated ${key} = ${value}`);
      }
    }

    if (changed) {
      store.set("server", schema);
      log.info("[Config] Changes saved to store");
    } else {
      log.info("[Config] No changes to save");
    }

    return true;
  } catch (err) {
    log.error("[Config] Failed to update config:", err);
    return false;
  }
};

// Reset the config to default
const resetConfig = () => {
  try {
    if (!store) {
      throw new Error("Config not initialized. Call initialize() first.");
    }

    log.info("[Config] Resetting config to defaults...");
    store.set("server", defaultConfig.server);
    updateConfigObject();
    log.info("[Config] Config reset successfully");
    return true;
  } catch (err) {
    log.error("[Config] Failed to reset config:", err);
    return false;
  }
};

module.exports = {
  initialize,
  config,
  getRawConfig,
  defaultConfig,
  refreshConfig,
  updateConfigValue,
  updateConfigValues,
  resetConfig,
  flattenConfig,
};
