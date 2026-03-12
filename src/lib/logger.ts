import log from "loglevel";

// Default to WARN in production. Override at runtime if needed.
log.setDefaultLevel(log.levels.WARN);

export default log;
