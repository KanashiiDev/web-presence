const STABLE_DATA_ATTRS = [
  /\[data-testid(?:=[^\]]+)?\]/i,
  /\[data-test(?:=[^\]]+)?\]/i,
  /\[data-test-id(?:=[^\]]+)?\]/i,
  /\[data-cy(?:=[^\]]+)?\]/i,
  /\[data-qa(?:=[^\]]+)?\]/i,
  /\[data-playwright(?:=[^\]]+)?\]/i,
  /\[data-selenium(?:=[^\]]+)?\]/i,
  /\[data-rpc(?:=[^\]]+)?\]/i,
  /\[qa-id(?:=[^\]]+)?\]/i,
];

const SIMPLE_PATTERNS = [
  /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*){1,4}$/i, // kebab-case (max 5 segments)
  /^[a-z][a-z0-9]*(_[a-z][a-z0-9]*){1,4}$/i, // snake_case (max 5 segments)
  /^[a-z][a-zA-Z0-9]{2,32}$/, // camelCase (reasonable length)
];

const ATTR_BLOCKLIST_PATTERNS = [
  // General - anchored to whole attribute name or a whole hyphen segment.
  // (unanchored /id/ used to block data-testid, data-video, data-hidden ...)
  /(^|-)(class|id|style|src|srcset|href|label|title|desc|description|tooltip|hint|placeholder|alt|content|text|innertext)(-|$)/i,
  /^aria-(label|labelledby|describedby|description|valuetext|placeholder)$/i,

  // Unique identifiers
  /^\[data-(id|key|guid|uuid|pk|ref|index)\]$/i,
  /^\[data-(id|key|guid|uuid|pk|ref)-[a-z]+\]$/i,

  // Authentication & Security
  /^\[data-(token|auth|session|csrf|api-key|secret)\]$/i,
  /^\[data-user(-id|-key|-token)?\]$/i,

  // URLs & Paths
  /^\[data-(src|srcset|href|url|link|path|endpoint)\]$/i,
  /^\[data-(image|video|audio|media)-url\]$/i,

  // Timestamps
  /^\[data-(ts|time|date|timestamp|created|updated|modified)\]$/i,
  /^\[data-(unix-time|iso-date|epoch)\]$/i,

  // Random/temporary values
  /^\[data-(temp|temporary|cache|nonce|hash|random)\]$/i,
  /^\[data-(temp|random|hash)-[a-z]+\]$/i,

  // Framework-generated IDs
  /^\[data-reactid\]$/i,
  /^\[data-react(root|id|boundary)?\]$/i,
  /^\[data-(vueid|vue-component|vue-ref)\]$/i,
  /^\[data-svelte-h\]$/i,
  /^\[data-(nextjs|next-route|next-data)\]$/i,
  /^\[data-(nuxt|nuxt-data|nuxt-component)\]$/i,
  /^\[data-(angular|ng)-.*\]$/i,
  /^\[data-(hydrate|hydration-id|hydration-key)\]$/i,
  /^\[data-(astro|astro-cid)\]$/i,
  /^\[data-(solid|solid-.*)\]$/i,
  /^\[data-(qwik|q:id|q:key)\]$/i,

  // Dynamic state/status
  /^\[data-(lazy|lazyload|lazyloaded|loaded|loading)\]$/i,
  /^\[data-(status|state|active|selected|open|closed)\]$/i,
  /^\[data-(index|count|total|page|step|position|offset)\]$/i,
  /^\[data-pos\]$/i,

  // Analytics & Tracking
  /^\[data-(gtm|google-tag-manager)\]$/i,
  /^\[data-(ga|google-analytics)\]$/i,
  /^\[data-(fb|facebook)-(pixel|track|event)\]$/i,
  /^\[data-(track|analytics|metrics|telemetry)\]$/i,
  /^\[data-(event|click|impression|view)\]$/i,
  /^\[data-(action|interaction)\]$/i,
  /^\[data-(idfa|gaid|advertising-id)\]$/i,
  /^\[data-(segment|amplitude|mixpanel|heap)\]$/i,
  /^\[data-(hotjar|hj|fullstory|logrocket)\]$/i,
  /^\[data-(mp|aa|adobe)-.*\]$/i,

  // A/B Testing & Experiments
  /^\[data-(variant|experiment|ab-test)\]$/i,
  /^\[data-(optimize|optimizely)\]$/i,

  // Performance monitoring
  /^\[data-(perf|performance|timing|metric)\]$/i,
  /^\[data-(sentry|bugsnag|rollbar)\]$/i,
];

const ID_BLOCKLIST_PATTERNS = [
  // React ecosystem
  /^css-[a-z0-9]{4,12}$/i,
  /^emotion-[a-z0-9]{4,10}$/i,
  /^sc-[a-z0-9]{4,12}$/i, // styled-components
  /^makeStyles-[a-z]+-\d{1,8}$/i, // Material-UI
  /^jss\d{1,8}$/i,

  // Component libraries
  /^chakra-[a-z0-9-]{4,32}$/i,
  /^mui[a-z]*-[a-z0-9-]{4,32}$/i,
  /^ant-[a-z0-9-]{4,32}$/i,
  /^mantine-[a-z0-9-]{4,32}$/i,
  /^radix-[a-z0-9-]{4,32}$/i,
  /^headlessui-[a-z0-9-]{4,32}$/i,

  // CSS-in-JS hashes
  /^_[a-z0-9]{3,12}_[a-z0-9]{3,12}$/i,
  /^[A-Z][a-z]+_[a-zA-Z0-9]+_[a-z0-9]{4,12}$/i,

  // Framework specific
  /^astro-[a-z0-9]{4,16}$/i,
  /^qwik-[a-z0-9]{4,16}$/i,
  /^solid-[a-z0-9]{4,16}$/i,
  /^svelte-[a-z0-9]{4,16}$/i,

  // Tailwind JIT
  /^tw-[a-z0-9]{4,16}$/i,

  // Generic hash patterns
  /^[a-z]{2,4}\d{4,8}[a-z]{2,4}\d{2,6}$/i,
  /^e[a-z]{2,4}\d[a-z0-9]{4,12}$/i,
];

const CLASS_BLOCKLIST_PATTERNS = [
  // Bootstrap buttons (btn, btn-primary, btn-lg, vb.)
  /^btn(-[a-z]+(-[a-z]+)?)?$/i,

  // Bootstrap grid (col-md-6, col-12, col-auto, vb.)
  /^col(-([a-z]{2,4})-(\d{1,2}|auto))?$/i,
  /^offset-([a-z]{2,4})-\d{1,2}$/i,
  /^order-([a-z]{2,4}-)?\d{1,2}$/i,

  // Spacing utilities (m-4, pt-8, -mt-4, m-0.5, p-1.5, vb.)
  /^-?(m|p)(t|r|b|l|x|y|s|e)?-(\d{1,3}(?:\.\d+)?|auto|px)$/i,

  // Layout utilities
  /^(d-(block|flex|grid|none|inline(-block|-flex)?)|container(-fluid|-sm|-md|-lg|-xl|-xxl)?|row|col)$/i,

  // Grid utilities (Tailwind/CSS Grid)
  /^grid(-cols|-rows)?(-(\d{1,2}|none|subgrid))?$/i,
  /^(col|row)-(auto|span-\d{1,2}|start-\d{1,2}|end-\d{1,2})$/i,

  // Text alignment and styling
  /^text-(center|left|right|justify|start|end)$/i,
  /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/i,
  /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/i,

  // Flexbox utilities
  /^(flex|inline-flex)(-row|-row-reverse|-col|-col-reverse|-wrap|-wrap-reverse|-nowrap)?$/i,
  /^(justify|items|content|self)-(start|end|center|between|around|evenly|stretch|baseline|auto)$/i,
  /^gap-(\d{1,3}|px)$/i,
  /^(flex-)?grow(-0|-\d+)?$/i,
  /^(flex-)?shrink(-0|-\d+)?$/i,

  // Width, height, sizing
  /^(w|h|min-w|max-w|min-h|max-h)-(\d{1,3}|px|auto|full|screen|min|max|fit)$/i,
  /^(w|h)-(\d+\/\d+)$/i, // w-1/2, h-3/4

  // Position utilities
  /^(static|fixed|absolute|relative|sticky)$/i,
  /^-?(top|right|bottom|left|inset)(-(\d{1,3}|px|auto|full))?$/i,
  /^(inset|inset-x|inset-y)(-(\d{1,3}|px|auto))?$/i,

  // Colors (background, text, border) - with or without shade numbers
  /^(bg|text|border|ring|fill|stroke)-(transparent|current|inherit|black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-(\d{2,3}|50))?$/i,

  // Border utilities
  /^border(-([trbl]|[xy]))?(-(\d|none))?$/i,
  /^rounded(-([trbl]|[tblr]{2}))?(-(none|sm|md|lg|xl|2xl|3xl|full))?$/i,
  /^(divide-[xy])(-(\d|reverse))?$/i,

  // Shadow, opacity, blur
  /^shadow(-(sm|md|lg|xl|2xl|inner|none))?$/i,
  /^opacity-(\d{1,3})$/i,
  /^blur(-(sm|md|lg|xl|2xl|3xl|none))?$/i,
  /^backdrop-(blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)(-[a-z0-9-]+)?$/i,

  // Transitions and animations
  /^transition(-([a-z]+|all|none))?$/i,
  /^duration-(\d{2,4})$/i,
  /^ease-(linear|in|out|in-out)$/i,
  /^delay-(\d{2,4})$/i,
  /^animate-(none|spin|ping|pulse|bounce)$/i,

  // Transform utilities
  /^-?(translate-[xy])-(\d{1,3}|px|full)$/i,
  /^-?rotate-(\d{1,3})$/i,
  /^-?scale(-[xy])?-(\d{1,3})$/i,
  /^-?skew-[xy]-(\d{1,2})$/i,

  // Overflow, z-index, cursor
  /^overflow(-[xy])?-(auto|hidden|visible|scroll|clip)$/i,
  /^text-overflow$/i,
  /^(align|justify)-items(-[a-z]+)?$/i,
  /^(align|justify)-self(-[a-z]+)?$/i,
  /^(align|justify)-content(-[a-z]+)?$/i,
  /^(w|h)-100$/i,
  /^-?z-(\d{1,4}|auto)$/i,
  /^cursor-(auto|default|pointer|wait|text|move|help|not-allowed|none|context-menu|progress|cell|crosshair|vertical-text|alias|copy|no-drop|grab|grabbing|all-scroll|col-resize|row-resize|n-resize|e-resize|s-resize|w-resize|ne-resize|nw-resize|se-resize|sw-resize|ew-resize|ns-resize|nesw-resize|nwse-resize|zoom-in|zoom-out)$/i,

  // Visibility, display states
  /^(visible|invisible|hidden|collapse)$/i,
  /^(pointer-events)-(none|auto)$/i,
  /^(select)-(none|text|all|auto)$/i,

  // Special utilities
  /^(clearfix|truncate|line-clamp-\d+|sr-only|not-sr-only)$/i,
  /^aspect-(auto|square|video|\d+\/\d+)$/i,
  /^object-(contain|cover|fill|none|scale-down)$/i,
  /^object-(top|right|bottom|left|center)$/i,

  // Gradient utilities
  /^(from|via|to)-(transparent|current|inherit|black|white|[a-z]+-\d{2,3})$/i,
  /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/i,

  // Ring utilities (Tailwind)
  /^ring(-\d+)?$/i,
  /^ring-offset(-\d+)?$/i,
  /^ring-inset$/i,

  // Responsive & state prefixes (MUST match full class)
  /^(sm|md|lg|xl|2xl|3xl):[a-z-]+[a-z0-9-]*$/i,
  /^(hover|focus|focus-within|focus-visible|active|visited|target|disabled|enabled|checked|indeterminate|default|required|valid|invalid|in-range|out-of-range|placeholder-shown|autofill|read-only):[a-z-]+[a-z0-9-]*$/i,
  /^(first|last|only|odd|even|first-of-type|last-of-type|only-of-type|empty):[a-z-]+[a-z0-9-]*$/i,
  /^dark:[a-z-]+[a-z0-9-]*$/i,
  /^(group|peer)-(hover|focus|active|disabled|checked):[a-z-]+[a-z0-9-]*$/i,

  // Arbitrary values syntax
  /^\w+(-\w+)*-\[[^\]]+\]$/i,

  // CSS Modules & styled-components hashes
  /^css-[a-z0-9]{4,12}$/i,
  /^_[a-z0-9]{3,8}_[a-z0-9]{3,8}$/i,
  /^[A-Za-z]+_[a-zA-Z0-9]+_[a-zA-Z0-9]{4,10}$/i,
  /^jss\d{2,5}$/i,
  /^makeStyles-[a-z]+-\d{1,5}$/i,

  // Component library prefixes
  /^(chakra|mui|ant|mantine|radix|headless|daisyui)-[a-z][a-z0-9-]*$/i,
  /^sc-[a-z]{2,8}-[a-z0-9]{2,8}$/i,

  // Emotion/styled-components patterns
  /^e[a-z]{2,4}\d[a-z0-9]{2,8}$/i,
  /^[a-z]{3,6}\d[a-z]{2,4}\d{1,4}$/i,

  // Short hash prefixes (c-3meqib, x-abc123, s-xyz789, etc.) - common in CSS-in-JS
  /^[a-z]-(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{4,12}$/i, // mixed letters+digits only (c-3meqib); c-title / a-link stay valid

  // Numbered index/placeholder classes (sc-artwork-placeholder-0, avatar-3, thumb_12)
  /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*[-_]\d{1,2}$/i,

  // Animation/transition helper classes (g-opacity-transition, fade-in, is-animating)
  /(^|[-_])(transition|animat\w*|fade\w*)([-_]|$)/i,

  // Bootstrap legacy
  /^(pull|float)-(left|right|none)$/i,
  /^show$/i,
  /^loading$/i,
  /^selected$/i,
  /^paused$/i,

  // Prose utilities (Tailwind Typography)
  /^(prose|not-prose)(-[a-z]+)?$/i,
];

// State/transient classes - filter at generation time to avoid noisy variants.
// Does NOT block semantic classes like current-song, playing-track, active-user.
const STATE_CLASS_PATTERNS = [
  /^(active|selected|open|closed|expanded|collapsed|focus|hover|disabled|loading|pending|error|success|visible|hidden|show|hide|enter|leave|current|playing|paused|muted|fullscreen|lazyloaded|lazyload|lazy)$/i,
  /^(is|has|are|was|will|can|should)[-_][a-z0-9][a-z0-9_-]*$/i, // is-active, has-error
  /^(is|has)[A-Z][A-Za-z0-9]*$/, // isPlaying, hasFocus
  /--[a-z0-9][a-z0-9-]*$/i, // BEM modifiers (block--modifier): variant/state, not identity
];

// Utility/responsive classes - unstable, viewport-dependent, not semantic
// These should NOT contribute to class chain bonus
const UTILITY_CLASS_PATTERNS = [
  // Bootstrap responsive visibility
  /^visible-(xs|sm|md|lg|xl|xxl|print)$/i,
  /^hidden-(xs|sm|md|lg|xl|xxl|print)$/i,
  /^invisible$/i,
  // Bootstrap display utilities
  /^d-(none|inline|inline-block|block|table|table-cell|table-row|flex|inline-flex|grid|inline-grid)(-(xs|sm|md|lg|xl|xxl))?$/i,
  // Bootstrap flex utilities
  /^flex-(row|column|row-reverse|column-reverse|wrap|nowrap|grow|shrink|fill|initial|auto)(-(xs|sm|md|lg|xl|xxl))?$/i,
  /^justify-content-(start|end|center|between|around|evenly)(-(xs|sm|md|lg|xl|xxl))?$/i,
  /^align-(items|self|content)-(start|end|center|baseline|stretch)(-(xs|sm|md|lg|xl|xxl))?$/i,
  // Bootstrap spacing utilities
  /^m[xytrblsae]?-[0-9]+(\.[0-9]+)?$/i,
  /^p[xytrblsae]?-[0-9]+(\.[0-9]+)?$/i,
  // Bootstrap float utilities
  /^float-(left|right|none)(-(xs|sm|md|lg|xl|xxl))?$/i,
  // Bootstrap text utilities
  /^text-(left|right|center|justify|start|end|lowercase|uppercase|capitalize|wrap|nowrap|truncate|break|monospace|reset|decoration-none|body|primary|secondary|success|danger|warning|info|light|dark|white|muted)(-(xs|sm|md|lg|xl|xxl))?$/i,
  // Bootstrap position utilities
  /^position-(static|relative|absolute|fixed|sticky)$/i,
  /^(top|bottom|start|end)-[0-9]+$/i,
  // Tailwind-style utilities
  /^(w|h|min-w|max-w|min-h|max-h)-(full|screen|auto|[0-9]+(\.[0-9]+)?)$/i,
  /^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|hidden|visible)$/i,
];

// Hash-like suffix: MUST contain a digit, so BEM elements (__avatar, __full, __elements) are not mistaken for hashes
const HASH_SUFFIX_PATTERN = /_(?=[a-z0-9]*\d)[a-z0-9]{4,12}(?:_\d+)?$/i;
