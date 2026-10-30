'use strict';

// Native DOM selectors proven in the data-management style laboratory.
// No row-height/top/transform overrides: the platform owns virtual grid geometry.
const presets = require('./data-manage-presets.json');

function renderNativeStyle(options) {
  const preset = presets.find(item => item.id === options.style);
  if (!preset) { throw new Error('Unknown data-management style'); }
  const palettes = {
    light: {page:'#F2F4F8', panel:'#FFFFFF', header:'#F4F6FA', line:'#E3E7EE', outer:'#CCD3DE', ink:'#20283A', muted:'#5C677D', link:'#3748A8', stripe:'#F4F6FA', hover:'#EDF1F7', selected:'#E9EDFF'},
    paper: {page:'#F5F0E7', panel:'#FFFBF3', header:'#EDE4D5', line:'#D7CBBB', outer:'#D7CBBB', ink:'#493D32', muted:'#695A4C', link:'#865735', stripe:'#F5F0E7', hover:'#F0E6D7', selected:'#E7D8C0'},
    sage: {page:'#EEF3EF', panel:'#F8FCF8', header:'#DDE9DF', line:'#C4D4C8', outer:'#C4D4C8', ink:'#2D4936', muted:'#526858', link:'#326746', stripe:'#EEF3EF', hover:'#E2EDE5', selected:'#CFE3D5'},
    ice: {page:'#EEF4FB', panel:'#F8FBFF', header:'#DDE9F7', line:'#C5D5E8', outer:'#C5D5E8', ink:'#293F58', muted:'#526A84', link:'#35649A', stripe:'#EEF4FB', hover:'#E2EDF8', selected:'#CFE0F3'},
    rose: {page:'#F6F0F2', panel:'#FFFAFC', header:'#EEE0E6', line:'#DCC9D2', outer:'#DCC9D2', ink:'#563F4A', muted:'#765D69', link:'#86546B', stripe:'#F6F0F2', hover:'#F1E5EA', selected:'#E7D3DD'},
    dark: {page:'#171E2C', panel:'#202939', header:'#293549', line:'#3C4A61', outer:'#3C4A61', ink:'#EAF0FC', muted:'#C1CCE0', link:'#AAB9FF', stripe:'#293549', hover:'#35445B', selected:'#3D4E7C'},
  };
  const horizontalStyles = new Set(['horizontal','zebra','flat','outline','shadow','toolbar-card','toolbar-tint','toolbar-dark','plain-header','tint-header','dark-header','reading','paper','sage','rose','dark-horizontal','dark-zebra']);
  const gridStyles = new Set(['grid','double','integrated','ice','dark-grid']);
  const borderlessStyles = new Set(['borderless','dark-flat']);
  // Page identity controls both the native experiment and the application shell.
  // Kept in application CSS; no Canvas code writes to an ancestor or app setting.
  const pagePalettes = {horizontal:'ice',zebra:'sage',outline:'ice',shadow:'rose',double:'paper','toolbar-card':'rose','toolbar-tint':'sage','toolbar-dark':'ice','tint-header':'ice','dark-header':'light',reading:'paper'};
  const paletteFor = style => palettes[pagePalettes[style] || style] || (style.startsWith('dark-') ? palettes.dark : palettes.light);
  const css = [];
  function rule(scope, suffixes, body) {
    const parts = Array.isArray(suffixes) ? suffixes : [suffixes];
    css.push(parts.map(s => `${scope}${s ? ' ' + s : ''}`).join(',\n') + ' {\n  ' + body.replace(/;\s*/g, ';\n  ').trim() + '\n}\n');
  }
  function mixColor(hex, target, ratio) {
    const channels = value => value.slice(1).match(/../g).map(channel => parseInt(channel, 16));
    const from = channels(hex), to = channels(target);
    return '#' + from.map((value, index) => Math.round(value + (to[index] - value) * ratio).toString(16).padStart(2, '0')).join('');
  }
  function colorControls(scope, p, dark, container = '') {
    const at = selector => container ? `${container} ${selector}` : selector;
    const hover = mixColor(p.link, dark ? '#FFFFFF' : '#000000', dark ? .18 : .12);
    const active = mixColor(p.link, dark ? '#FFFFFF' : '#000000', dark ? .3 : .22);
    const ink = dark ? p.page : '#FFFFFF';
    rule(scope, container, `--color-brand1-1:${p.hover}; --color-brand1-2:${p.selected}; --color-brand1-3:${p.outer}; --color-brand1-5:${hover}; --color-brand1-6:${p.link}; --color-brand1-9:${active}; --color-brand1-10:${p.link}; --input-hover-border-color:${p.link}; --input-focus-border-color:${p.link};`);
    // Preserve native disabled and text-button behavior. Solid actions need an
    // explicit foreground as light experimental accents also occur on dark lists.
    const solid = '.next-btn-primary:not(.next-btn-text):not([disabled]):not([aria-disabled="true"])';
    rule(scope, at(solid), `background:${p.link} !important; border-color:${p.link} !important; color:${ink} !important;`);
    rule(scope, [at(`${solid} .next-icon`), at(`${solid} .next-btn-helper`)], `color:${ink} !important;`);
    rule(scope, at(`${solid}:hover`), `background:${hover} !important; border-color:${hover} !important; color:${ink} !important;`);
    rule(scope, at(`${solid}:active`), `background:${active} !important; border-color:${active} !important; color:${ink} !important;`);
    rule(scope, at(`${solid}:focus-visible`), `outline:2px solid ${p.link}; outline-offset:2px;`);
    const simple = container ? '.next-btn-simple' : '.data-manage-operaion .next-btn-simple';
    rule(scope, at(simple), `color:${p.ink} !important;`);
    rule(scope, at(`${simple}:hover`), `background:${p.hover} !important; color:${p.link} !important;`);
    if (!container) {
      const currentPage = '.next-pagination-item.next-current:not([disabled]):not([aria-disabled="true"]):not(.disabled)';
      rule(scope, currentPage, `background:${p.link} !important; border-color:${p.link} !important; color:${ink} !important;`);
      rule(scope, `${currentPage}:hover`, `background:${hover} !important; border-color:${hover} !important; color:${ink} !important;`);
      rule(scope, `${currentPage}:active`, `background:${active} !important; border-color:${active} !important; color:${ink} !important;`);
      rule(scope, ['#newDataManageTable .notable-yida-action-column-btns.next-btn-text', '#newDataManageTable .notable-yida-action-column-btns.next-btn-text > a.link'], `color:${p.link} !important;`);
      rule(scope, ['#newDataManageTable .notable-yida-action-column-btns.next-btn-text:hover', '#newDataManageTable .notable-yida-action-column-btns.next-btn-text:hover > a.link'], `color:${hover} !important;`);
      if (dark) {rule(scope, '#newDataManageTable label:has(input[type="checkbox"]:checked) svg path', `fill:${ink} !important;`);}
    }
  }
  // Each native variant owns its entire visible chrome. These variables are
  // declared only on the matching manager's direct views-tab and list root;
  // details, submission forms, other tabs and virtual row metrics never inherit
  // them. Common DOM consumers below avoid repeating all 212 field IDs.
  function nativeChrome(managerScope, scope, variant, p, dark) {
    const recipes = {
      grid:          ['line',      2,16,'1px solid','none',         'transparent','none',0,0,'none','none'],
      horizontal:    ['long-line', 0,20,'none','none',              'transparent','bottom',0,4,'none','none'],
      borderless:    ['text',      0,24,'none','none',              'transparent','none',0,0,'none','none'],
      zebra:         ['segment',  12,16,'1px solid','none',         'transparent','none',8,8,'fill','fill'],
      flat:          ['line',      0,0,'none','none',               'transparent','none',0,0,'none','left-line'],
      outline:       ['outline',   4,14,'1px solid','none',         'transparent','outline',4,6,'none','none'],
      shadow:        ['pill',     20,20,'none','shadow',            'transparent','none',12,8,'fill','fill'],
      double:        ['box',       0,12,'3px double','none',        'transparent','double',0,8,'none','none'],
      integrated:    ['compact',   8,12,'1px solid','none',         'header','bottom',0,10,'none','none'],
      'toolbar-card':['pill',      0,0,'none','none',              'transparent','none',10,8,'card','card'],
      'toolbar-tint':['segment',  12,12,'1px solid','accent-top',   'selected','none',8,10,'none','none'],
      'toolbar-dark':['pill',     16,12,'none','shadow',            'dark','none',10,10,'none','none'],
      'plain-header':['line',      0,20,'1px solid','none',         'transparent','strong-bottom',0,8,'none','none'],
      'tint-header': ['segment',  12,16,'1px solid','accent-top',   'transparent','none',8,8,'fill','outline'],
      'dark-header': ['compact',   6,16,'1px solid','none',         'transparent','none',4,0,'none','none'],
      reading:       ['large-pill',24,24,'none','shadow',           'transparent','none',12,10,'card','card'],
      paper:         ['double-line',0,20,'3px double','paper',     'transparent','dotted',0,8,'none','left-line'],
      sage:          ['round-segment',24,20,'1px solid','none',    'transparent','none',20,10,'fill','fill'],
      ice:           ['outline',   4,16,'2px solid','none',        'transparent','outline',4,8,'none','fill'],
      rose:          ['pill',     20,20,'none','rose',             'transparent','none',8,0,'none','fill'],
      'dark-grid':   ['box',       0,16,'2px solid','none',        'header','outline',0,8,'none','left-line'],
      'dark-horizontal':['line',   8,20,'none','accent-top',       'transparent','bottom',0,8,'none','left-line'],
      'dark-zebra':  ['round-segment',18,16,'3px solid','none',    'transparent','none',12,10,'fill','fill'],
      'dark-flat':   ['text',      0,0,'none','none',              'transparent','none',0,6,'none','none'],
    };
    const [mode,radius,padding,border,shadowKind,toolSurface,toolBorder,toolRadius,toolPadding,leftMode,rightMode] = recipes[variant.style];
    const line=p.outer, accent=p.link, soft=p.header, face=p.panel;
    const borderValue = border==='none'?'none':`${border} ${line}`;
    const shadow = shadowKind==='shadow' ? `0 8px 26px ${dark?'rgba(0,0,0,.25)':'rgba(32,40,58,.10)'}` : shadowKind==='accent-top' ? `inset 0 3px 0 ${accent}` : shadowKind==='paper' ? '4px 4px 0 #D7CBBB' : shadowKind==='rose' ? '0 10px 28px rgba(86,63,74,.14)' : 'none';
    const isPill=['pill','large-pill','round-segment'].includes(mode);
    const segmented=['segment','round-segment'].includes(mode);
    const boxed=['outline','box','attached'].includes(mode);
    const lined=['line','long-line','double-line'].includes(mode);
    const tabRadius=isPill?24:segmented?8:mode==='compact'?6:mode==='box'?0:boxed?4:0;
    const navBg=segmented?soft:mode==='attached'?soft:'transparent';
    const navBorder=mode==='outline'?`1px solid ${line}`:mode==='box'?`2px solid ${line}`:mode==='attached'?`1px solid ${line}`:'none';
    const activeBg=lined||mode==='text'?'transparent':p.selected;
    const activeShadow=mode==='double-line'?`inset 0 -1px 0 ${accent},inset 0 -3px 0 ${p.page},inset 0 -4px 0 ${accent}`:lined?`inset 0 -${mode==='long-line'?3:2}px 0 ${accent}`:mode==='text'?'none':boxed?`inset 0 0 0 1px ${accent}`:'none';
    const tabVars=`--lab-native-tab-canvas:${p.page}; --lab-native-tab-face:${navBg}; --lab-native-tab-border:${navBorder}; --lab-native-tab-nav-radius:${segmented?tabRadius:mode==='outline'?6:0}px; --lab-native-tab-nav-padding:${segmented||boxed?4:0}px; --lab-native-tab-gap:${mode==='long-line'?20:mode==='text'?18:segmented?2:8}px; --lab-native-tab-radius:${tabRadius}px; --lab-native-tab-active:${activeBg}; --lab-native-tab-active-shadow:${activeShadow}; --lab-native-tab-pad:${mode==='large-pill'?'12px 22px':mode==='text'?'8px 4px':'8px 16px'}; --lab-native-tab-margin:${mode==='attached'?0:16}px; --lab-native-tab-ink:${p.ink}; --lab-native-tab-muted:${p.muted}; --lab-native-tab-accent:${accent}; --lab-native-tab-hover:${p.hover};`;
    rule(managerScope,'> .views-tab',tabVars);
    if (variant.style === 'dark-flat') {
    // Nav-free native managers retain a platform white background even when
    // the document tokens change; cover the actual two paint surfaces.
      rule(managerScope,'',`background:${p.page} !important;`);
      rule(managerScope,'> .vc-yida-form-manage-content',`background:${p.page} !important;`);
      rule(managerScope,'> .views-tab','padding-inline:20px !important; --lab-native-tab-margin:4px;');
      rule(scope,'.data-manage-operaion','padding-inline:0 !important;');
    }
    if (['integrated','dark-header'].includes(variant.style)) {
    // Two tabs should not draw an empty, full-width enclosure. Match the
    // existing data panel inset without touching its virtual table geometry.
      rule(managerScope,'> .views-tab','padding-inline:20px !important; --lab-native-tab-margin:0px;');
      rule(managerScope,'> .views-tab .next-tabs-nav[role="tablist"]','width:fit-content; max-width:100%;');
      rule(managerScope,'> .views-tab .next-tabs-nav-container','margin-bottom:0 !important;');
    }
    const toolBg=toolSurface==='dark'?palettes.dark.panel:toolSurface==='selected'?p.selected:toolSurface==='header'?soft:'transparent';
    const toolInk=toolSurface==='dark'?palettes.dark.ink:p.ink;
    const toolEdge=toolBorder==='outline'?`1px solid ${line}`:toolBorder==='double'?`3px double ${line}`:'none';
    const bottom=toolBorder==='bottom'?`1px solid ${line}`:toolBorder==='strong-bottom'?`2px solid ${p.ink}`:toolBorder==='dotted'?`1px dashed ${line}`:toolEdge;
    const sideStyle=kind=>({bg:kind==='fill'?soft:kind==='card'?face:'transparent',border:kind==='card'||kind==='outline'?`1px solid ${line}`:'none',left:kind==='left-line'?`2px solid ${line}`:'none',bottom:kind==='bottom-line'?`2px solid ${accent}`:'none',pad:['fill','card','outline'].includes(kind)?'6px 8px':'0',radius:['fill','card','outline'].includes(kind)?toolRadius:0,shadow:kind==='card'?'0 3px 10px rgba(32,40,58,.08)':'none'});
    const left=sideStyle(leftMode),right=sideStyle(rightMode);
    const buttonRadii = {grid:4,horizontal:4,borderless:4,zebra:8,flat:2,outline:4,shadow:12,double:0,integrated:4,'toolbar-card':10,'toolbar-tint':8,'toolbar-dark':8,'plain-header':2,'tint-header':6,'dark-header':4,reading:12,paper:0,sage:24,ice:2,rose:10,'dark-grid':2,'dark-horizontal':6,'dark-zebra':12,'dark-flat':4};
    const buttonRadius=buttonRadii[variant.style];
    rule(scope,'',`--lab-native-control-radius:${buttonRadius}px; --lab-native-control-padding:${buttonRadius>=20?16:buttonRadius===0?10:12}px;`);
    rule(scope,'',`--lab-native-content-radius:${radius}px; --lab-native-content-padding:${padding}px; --lab-native-content-border:${borderValue}; --lab-native-content-shadow:${shadow}; --lab-native-toolbar-bg:${toolBg}; --lab-native-toolbar-ink:${toolInk}; --lab-native-toolbar-border:${toolEdge}; --lab-native-toolbar-bottom:${bottom}; --lab-native-toolbar-radius:${toolRadius}px; --lab-native-toolbar-padding:${toolPadding}px; --lab-native-toolbar-gap:${variant.style==='double'?8:12}px; --lab-native-toolbar-margin:${variant.style==='integrated'?0:14}px; --lab-native-left-bg:${left.bg}; --lab-native-left-border:${left.border}; --lab-native-left-bottom:${left.bottom}; --lab-native-left-padding:${left.pad}; --lab-native-left-radius:${left.radius}px; --lab-native-left-shadow:${left.shadow}; --lab-native-right-bg:${right.bg}; --lab-native-right-border:${right.border}; --lab-native-right-left:${right.left}; --lab-native-right-padding:${right.pad}; --lab-native-right-radius:${right.radius}px; --lab-native-right-shadow:${right.shadow};`);
  }
  function nativeChromeConsumers(managerScope) {
    const tabs=managerScope+' > .next-tabs.views-tab';
    rule(tabs,'','background:var(--lab-native-tab-canvas,var(--pod-page-bg-color)) !important;');
    rule(tabs,'.next-tabs-bar','border-bottom:0 !important; background:transparent !important; margin-bottom:var(--lab-native-tab-margin,16px) !important;');
    rule(tabs,'.next-tabs-nav[role="tablist"]','display:flex; gap:var(--lab-native-tab-gap,8px); padding:var(--lab-native-tab-nav-padding,0px) !important; background:var(--lab-native-tab-face,transparent) !important; border:var(--lab-native-tab-border,none) !important; border-radius:var(--lab-native-tab-nav-radius,0px) !important;');
    rule(tabs,'.next-tabs-tab[role="tab"]','margin:0 !important; border:0 !important; border-radius:var(--lab-native-tab-radius,0px) !important; color:var(--lab-native-tab-muted,var(--color-text1-3)) !important; background:transparent !important; box-shadow:none !important;');
    rule(tabs,['.next-tabs-tab[role="tab"]::before','.next-tabs-tab[role="tab"]::after'],'border:0 !important; background:transparent !important; box-shadow:none !important;');
    rule(tabs,'.next-tabs-tab[role="tab"] > .next-tabs-tab-inner','padding:var(--lab-native-tab-pad,8px 16px) !important; border:0 !important; color:inherit !important;');
    rule(tabs,'.next-tabs-tab[role="tab"] .views-tab-item','color:inherit !important;');
    rule(tabs,'.next-tabs-tab[role="tab"]:hover','color:var(--lab-native-tab-ink,var(--color-text1-4)) !important; background:var(--lab-native-tab-hover,var(--color-fill1-1)) !important;');
    rule(tabs,'.next-tabs-tab[role="tab"][aria-selected="true"]','color:var(--lab-native-tab-accent,var(--color-brand1-6)) !important; background:var(--lab-native-tab-active,transparent) !important; box-shadow:var(--lab-native-tab-active-shadow,none) !important; font-weight:600;');
    rule(tabs,'.next-tabs-tab[role="tab"]:focus-visible','outline:2px solid var(--lab-native-tab-accent,var(--color-brand1-6)); outline-offset:2px;');
    const native=managerScope+' .new-data-manage';
    rule(native,'.data-manage-content','border:var(--lab-native-content-border,none) !important; border-radius:var(--lab-native-content-radius,8px) !important; padding:var(--lab-native-content-padding,16px) !important; box-shadow:var(--lab-native-content-shadow,none) !important;');
    rule(native,'.data-manage-operaion','background:var(--lab-native-toolbar-bg,transparent) !important; color:var(--lab-native-toolbar-ink,var(--color-text1-4)) !important; border:var(--lab-native-toolbar-border,none) !important; border-bottom:var(--lab-native-toolbar-bottom,none) !important; border-radius:var(--lab-native-toolbar-radius,0px) !important; padding:var(--lab-native-toolbar-padding,0px) !important; margin-bottom:var(--lab-native-toolbar-margin,12px) !important; gap:var(--lab-native-toolbar-gap,12px);');
    rule(native,'.data-manage-operaion > .operation-left','background:var(--lab-native-left-bg,transparent) !important; border:var(--lab-native-left-border,none) !important; border-bottom:var(--lab-native-left-bottom,none) !important; border-radius:var(--lab-native-left-radius,0px) !important; padding:var(--lab-native-left-padding,0px) !important; box-shadow:var(--lab-native-left-shadow,none) !important;');
    rule(native,'.data-manage-operaion > .operation-right','background:var(--lab-native-right-bg,transparent) !important; border:var(--lab-native-right-border,none) !important; border-left:var(--lab-native-right-left,none) !important; border-radius:var(--lab-native-right-radius,0px) !important; padding:var(--lab-native-right-padding,0px) !important; box-shadow:var(--lab-native-right-shadow,none) !important;');
    rule(native,['.data-manage-operaion .next-btn-primary','.data-manage-operaion .next-btn-simple','.data-manage-operaion .next-btn-normal','.data-manage-operaion .operation-action'],'border-radius:var(--lab-native-control-radius,4px) !important;');
    rule(native,['.data-manage-operaion .next-btn-primary:not(.operation-left-action-icon-only)','.data-manage-operaion .next-btn-simple:not(.operation-left-action-icon-only)','.data-manage-operaion .operation-action'],'padding-inline:var(--lab-native-control-padding,12px) !important;');
    rule(native,'.next-pagination .next-pagination-item','border-radius:var(--lab-native-control-radius,4px) !important;');
  }
  const variant = {style: options.style, name: preset.name, key: options.style};
  const formId = options.form, fieldIds = options.fieldIds || [];
  {
    const style = variant.style;
    if (!horizontalStyles.has(style) && !gridStyles.has(style) && !borderlessStyles.has(style)) {throw Error(`Unknown style ${style}`);}
    // v15 is a dark HEADER experiment on the light body, unlike v21-v24.
    const dark = ['dark-grid','dark-horizontal','dark-zebra','dark-flat'].includes(style);
    const p = paletteFor(style);
    // Header or cell evidence from ANY visible business column keeps the same
    // variant active when native "显示列" hides the first column. The table
    // guard and .new-data-manage target exclude submit / detail pages.
    const fieldEvidence = fieldIds.flatMap(id => [`[data-field-id="${id}"]`, `[data-column-key="${id}"]`]).join(',');
    const selectedScope = `body:has(.next-selected[data-formuuid="${formId}"]) .vc-yida-form-manage`;
    const managerScope = fieldIds.length ? `:is(${selectedScope}, .vc-yida-form-manage:has(#newDataManageTable :is(${fieldEvidence})))` : selectedScope;
    const scope = `${managerScope} .new-data-manage`;
    const G = '#newDataManageTable';
    const D = `${G} .DataCellWrapper[data-field-id][role="gridcell"]`;
    const H = `${G} [data-role="header-cell"][data-column-key]`;
    // HeaderRight and the action placeholder are siblings, not field cells.
    // Paint their full surfaces without targeting generated classes or body rows.
    const headerSurfaces = [H, `${G} .leftHeaderPane`, `${G} .leftHeaderPane ~ div`];
    const R = `${G} [role="row"][aria-rowindex]`;
    const C = '.data-manage-content';
    const T = '.data-manage-operaion';
    const flat = style === 'flat' || style === 'dark-flat';
    const panel = flat ? p.page : p.panel;
    const header = flat ? p.page : style === 'plain-header' || style === 'shadow' || style === 'borderless' ? p.panel : style === 'tint-header' ? p.selected : style === 'dark-header' ? palettes.dark.header : p.header;
    const headerInk = style === 'dark-header' ? palettes.dark.ink : style === 'tint-header' ? p.link : p.ink;
    css.push(`/* ${variant.key}: ${variant.name} | ${style} | form=${formId}; fields=${fieldIds.join(',')} */`);
    rule(scope,'',`--table-border:${p.outer}; --table-cell-border:${p.line}; --table-header-bg:${header}; --table-cell-bg:${panel}; --pod-table-cell-color:${panel}; --pod-page-bg-color:${p.page}; --pod-card-bg-color:${panel}; --color-text1-4:${p.ink}; --color-text1-3:${p.muted}; --color-text1-2:${p.muted}; --color-text1-1:${p.muted}; --color-text1-10:${p.ink}; --color-line1-1:${p.line}; --color-line1-2:${p.outer}; --color-fill1-1:${p.header}; --color-fill1-2:${p.hover}; --color-fill1-3:${p.selected}; --color-fill1-5:${panel}; --color-fill1-6:${p.muted}; --input-bg-color:${panel}; --input-border-color:${p.outer}; --input-hover-bg-color:${panel}; --input-focus-bg-color:${panel}; background:${p.page} !important; color:${p.ink};`);
    const radius = flat ? 0 : ['integrated','plain-header','tint-header','dark-header','sage','ice','rose','dark-grid','dark-horizontal','dark-zebra'].includes(style) ? 8 : style === 'paper' ? 6 : 10;
    const padding = flat || style === 'toolbar-card' ? 0 : ['integrated','toolbar-tint','toolbar-dark'].includes(style) ? 12 : 16;
    const outerBorder = ['outline','double','integrated','toolbar-tint','plain-header','tint-header','dark-header','paper','sage','ice','rose','dark-grid','dark-horizontal','dark-zebra'].includes(style) ? `1px solid ${p.outer}` : 'none';
    const shadow = style === 'shadow' ? '0 4px 16px rgba(32,40,58,.06)' : style === 'double' ? 'inset 0 0 0 2px #EDF1F7' : 'none';
    rule(scope,C,`background:${flat || style === 'toolbar-card' ? 'transparent' : p.panel} !important; border:var(--lab-native-content-border,${outerBorder}) !important; border-radius:var(--lab-native-content-radius,${radius}px) !important; padding:var(--lab-native-content-padding,${padding}px) !important; box-shadow:var(--lab-native-content-shadow,${shadow}) !important;`);
    const gridBorder = flat || borderlessStyles.has(style) || ['outline','shadow'].includes(style) ? 'none' : `1px solid ${p.line}`;
    rule(scope,G,`background:${panel} !important; border:${gridBorder} !important; border-radius:${flat || style === 'borderless' ? 0 : style === 'toolbar-card' ? 6 : 4}px !important; box-shadow:none !important;`);
    rule(scope,[`${G} [role="grid"]`,`${G} .left-pane`,`${G} .main-content-rows`],`background:${panel} !important; color:${p.ink} !important;`);
    // The fixed-pane wrapper starts at the header and must not cover it.
    rule(scope,`${G} .right-fixed-pane`,'background:transparent !important;');
    rule(scope,D,`background:${panel} !important; color:${p.ink} !important; border-bottom:0 !important;`);
    rule(scope,headerSurfaces,`background:${header} !important; color:${headerInk} !important; border-bottom:1px solid ${p.line} !important;`);
    // The native checkbox header child already has a bottom border. Adding a
    // second one on leftHeaderPane produces a short double rule below the checkbox.
    rule(scope,`${G} .leftHeaderPane > div`,'border-bottom:0 !important;');
    rule(scope,R,`background:${panel} !important; color:${p.ink} !important; border-bottom:${borderlessStyles.has(style) ? '0' : `1px solid ${p.line}`} !important;`);
    const vertical = gridStyles.has(style) ? `1px solid ${p.line}` : '0';
    rule(scope,[D,H,`${G} .next-table th`,`${G} .next-table td`],`border-left:0 !important; border-right:${vertical} !important; border-inline-start:0 !important; border-inline-end:${vertical} !important;`);
    if (!gridStyles.has(style)) {
      rule(scope,`${G} div`,'border-left:0 !important; border-right:0 !important; border-inline-start:0 !important; border-inline-end:0 !important;');
      rule(scope,[`${H}::before`,`${H}::after`,`${D}::before`,`${D}::after`],'border-left:0 !important; border-right:0 !important; box-shadow:none !important;');
    }
    rule(scope,[`${G} .next-table th`,`${G} .next-table td`],`border-bottom:${borderlessStyles.has(style) ? '0' : `1px solid ${p.line}`} !important; background:${panel} !important; color:${p.ink} !important;`);
    rule(scope,`${G} .next-table th`,`background:${header} !important; color:${headerInk} !important; border-bottom:1px solid ${p.line} !important;`);
    rule(scope,T,'background:var(--lab-native-toolbar-bg,transparent) !important; border:var(--lab-native-toolbar-border,0) !important; border-bottom:var(--lab-native-toolbar-bottom,0) !important; border-radius:var(--lab-native-toolbar-radius,0) !important; padding:var(--lab-native-toolbar-padding,0) !important; margin-bottom:var(--lab-native-toolbar-margin,12px) !important; gap:var(--lab-native-toolbar-gap,12px); box-shadow:none !important;');
    if (style === 'integrated') {
      rule(scope,G,'border-top:0 !important; border-top-left-radius:0 !important; border-top-right-radius:0 !important;');
    }
    if (style === 'toolbar-dark') {
      rule(scope,T,`--color-text1-4:${palettes.dark.ink}; --color-text1-3:${palettes.dark.muted}; --color-text1-2:${palettes.dark.muted}; --color-fill1-1:${palettes.dark.header}; --color-fill1-2:${palettes.dark.hover}; --color-line1-1:${palettes.dark.line}; --color-line1-2:${palettes.dark.line}; color:${palettes.dark.ink} !important;`);
      rule(scope,[`${T} .next-btn-normal`,`${T} .next-input`,`${T} .next-select-inner`],`background:${palettes.dark.header} !important; color:${palettes.dark.ink} !important; border-color:${palettes.dark.line} !important;`);
      rule(scope,[`${T} .next-btn-normal .next-icon`,`${T} .next-input input`,`${T} .next-select-inner .next-icon`],`color:${palettes.dark.ink} !important;`);
      rule(scope,`${T} input::placeholder`,`color:${palettes.dark.muted} !important;`);
    }
    if (['plain-header','tint-header','dark-header'].includes(style)) {rule(scope,headerSurfaces,`font-weight:600 !important; border-bottom:${style === 'plain-header' ? 2 : 1}px solid ${p.outer} !important;`);}
    if (['plain-header','tint-header','dark-header'].includes(style)) {rule(scope,`${G} .leftHeaderPane`,`border-bottom:${style === 'plain-header' ? 2 : 1}px solid ${p.outer} !important;`);}
    if (style === 'dark-header') {
    // Header labels explicitly consume text tokens instead of inheriting color.
    // Keep these overrides on header cells so record text stays dark on white.
      rule(scope,[...headerSurfaces,`${G} .next-table th`],`--color-text1-2:${palettes.dark.muted}; --color-text1-3:${palettes.dark.muted}; --color-text1-4:${headerInk}; --color-text1-10:${headerInk}; --color-line1-1:${palettes.dark.muted}; --color-line1-2:${palettes.dark.muted};`);
      rule(scope,`${H} .next-icon`,`color:${headerInk} !important;`);
      rule(scope,`${G} .leftHeaderPane input[type="checkbox"]:not(:checked) + span`,`border-color:${palettes.dark.muted} !important;`);
    }
    if (style === 'zebra' || style === 'dark-zebra') {
      const even = ['0','2','4','6','8'].map(n => `${R}[aria-rowindex$="${n}"]:not(:hover):not([aria-selected="true"])`);
      rule(scope,even.flatMap(row => [row,`${row} .DataCellWrapper[data-field-id]`]),`background:${p.stripe} !important;`);
      rule(scope,`${G} .next-table-body tr:nth-child(even):not(:hover):not(.selected) td`,`background:${p.stripe} !important;`);
    }
    rule(scope,[`${R}:hover`,`${R}:hover .DataCellWrapper[data-field-id]`,`${G} .next-table-body tr:hover td`],`background:${p.hover} !important;`);
    rule(scope,[`${R}[aria-selected="true"]`,`${R}[aria-selected="true"] .DataCellWrapper[data-field-id]`,`${G} .next-table-body tr.selected td`],`background:${p.selected} !important;`);
    rule(scope,[`${D} a`,`${G} .next-table td a`],`color:${p.link} !important;`);
    if (dark) {
      rule(scope,'','--yida-danger-color:#FF9B7F;');
      rule(scope,[`${G} .notable-yida-action-column-btns.next-btn-text`,`${G} .notable-yida-action-column-btns.next-btn-text > a.link`],`color:${p.link} !important;`);
      rule(scope,[`${G} .notable-yida-action-column-btns.next-btn-text:hover`,`${G} .notable-yida-action-column-btns.next-btn-text:hover > a.link`],'color:#D0D9FF !important;');
      rule(scope,[`${T} .next-btn-normal`,`${T} .next-input`,`${T} .next-select-inner`],`background:${p.header} !important; border-color:${p.line} !important; color:${p.ink} !important;`);
      rule(scope,[`${T} input`,`${T} .next-icon`,`${H} .next-icon`],`color:${p.ink} !important;`);
      rule(scope,`${T} input::placeholder`,`color:${p.muted} !important;`);
      // Pagination has several fixed light-theme text colors. Override only
      // its documented/native classes inside these four dark list roots.
      rule(scope,['.next-pagination','.next-pagination .next-pagination-total','.next-pagination .next-pagination-size-selector-title','.next-pagination .next-pagination-size-selector'],`color:${p.muted} !important;`);
      rule(scope,['.next-pagination [role="combobox"]','.next-pagination .next-select-inner','.next-pagination .next-input'],`background:${p.header} !important; border-color:${p.line} !important; color:${p.ink} !important;`);
      rule(scope,['.next-pagination .next-select-values','.next-pagination .next-select-placeholder','.next-pagination .next-select-inner .next-icon','.next-pagination input'],`color:${p.muted} !important;`);
      rule(scope,'.next-pagination input::placeholder',`color:${p.muted} !important;`);
      rule(scope,'.next-pagination .next-btn-normal',`background:${p.header} !important; border-color:${p.line} !important; color:${p.ink} !important;`);
      rule(scope,'.next-pagination .next-btn-normal:hover:not([disabled]):not(.disabled)',`background:${p.hover} !important; color:${p.ink} !important; border-color:${p.muted} !important;`);
      rule(scope,['.next-pagination .next-btn[disabled]','.next-pagination .next-btn.disabled'],`background:${p.panel} !important; border-color:${p.line} !important; color:#8D9BB1 !important; opacity:1;`);
    }
    colorControls(scope, p, dark);
    if (style === 'toolbar-dark') {colorControls(scope, palettes.dark, true, T);}
    nativeChrome(managerScope,scope,variant,p,dark);
    nativeChromeConsumers(managerScope);
    if (options.focus === 'actions') {
      rule(scope,T,`padding:12px !important; background:${p.header} !important; border:1px solid ${p.outer} !important; border-radius:8px !important;`);
      rule(scope,`${T} > .operation-left`,'padding:0 !important; border:0 !important; background:transparent !important; box-shadow:none !important; gap:8px;');
      rule(scope,`${T} .next-btn-primary:not(.next-btn-text):not([disabled])`,'font-weight:600; min-height:36px; padding-inline:16px !important;');
      rule(scope,`${G} .notable-yida-action-column-btns > a.link`,'font-weight:600; text-decoration:underline; text-underline-offset:3px;');
      // A dark toolbar keeps its own foreground/background pair in action mode.
      if (style === 'toolbar-dark') {rule(scope,T,`background:${palettes.dark.panel} !important; border-color:${palettes.dark.line} !important;`);}
    }
    for (const id of options.emphasizeFields || []) {
      const cell = `${G} .DataCellWrapper[data-field-id="${id}"][role="gridcell"]`;
      const head = `${G} [data-role="header-cell"][data-column-key="${id}"]`;
      const foreground = dark ? p.page : '#FFFFFF';
      rule(scope, head, `background:${p.link} !important; color:${foreground} !important; --color-text1-2:${foreground}; --color-text1-3:${foreground}; --color-text1-4:${foreground}; --color-text1-10:${foreground}; font-weight:700 !important;`);
      rule(scope, `${head} .next-icon`, `color:${foreground} !important;`);
      rule(scope, cell, `background:${p.selected} !important; color:${p.ink} !important; --color-text1-4:${p.ink}; --color-text1-3:${p.ink}; font-weight:600 !important;`);
      rule(scope, `${cell} .data-view-container`, `color:${p.ink} !important; font-weight:600 !important;`);
      rule(scope, `${R}:hover .DataCellWrapper[data-field-id="${id}"]`, `background:${mixColor(p.selected, p.link, .12)} !important;`);
      rule(scope, [`${R}[aria-selected="true"] .DataCellWrapper[data-field-id="${id}"]`, `${cell}[data-in-selected-area="true"]`], `background:${mixColor(p.selected, p.link, .22)} !important;`);
    }
    // Uniform labels, not value-based conditional formatting. Do not infer
    // business status from row order, instance IDs or text-only CSS selectors.
    for (const id of options.tagFields || []) {
      rule(scope, `${G} .DataCellWrapper[data-field-id="${id}"] [data-componentname="SelectField"] .next-form-item-control > .next-form-preview`, `display:inline-flex; align-items:center; padding:0 8px; max-width:100%; box-sizing:border-box; line-height:20px; border:1px solid ${p.outer}; border-radius:4px; background:${p.header}; color:${p.ink} !important; font-size:12px; font-weight:600;`);
    }
    if (options.followShell) {
      const nav = ['toolbar-dark','dark-header'].includes(style) ? palettes.dark : p;
      const root = `body:has(.next-selected[data-formuuid="${formId}"])`;
      const tokens = {
        '--pod-app-root-bg-color':p.page,'--pod-page-bg-color':p.page,'--pod-card-bg-color':p.panel,
        '--pod-shell-theme-bg-color':nav.header,'--pod-nav-l-sub-main-bg-color':nav.header,'--pod-nav-l-container-bg':nav.header,
        '--pod-nav-menu-bg-hover-color':nav.hover,'--pod-nav-menu-bg-selected-color':nav.selected,
        '--pod-nav-item-text-color':nav.ink,'--pod-nav-item-text-hover-color':nav.link,'--pod-nav-item-text-selected-color':nav.link,
        '--pod-nav-logo-text':nav.ink,'--pod-nav-logo-bg':nav.link,'--pod-nav-logo-icon':nav===palettes.dark?nav.page:'#FFFFFF',
        '--pod-nav-search-bg-color':nav.panel,'--pod-nav-search-text-color':nav.ink,'--pod-nav-search-placeholder-color':nav.muted,
        '--pod-nav-search-icon-color':nav.muted,'--pod-nav-search-border-color':nav.line,
        '--pod-nav-action-icon-color':nav.ink,'--pod-nav-sub-divider-color':nav.line
      };
      rule(`:is(${root}, ${root} .pod-premium)`,'',Object.entries(tokens).map(([k,v])=>`${k}:${v};`).join(' '));
    }
  }
  return css.join('\n');

}
module.exports = { renderNativeStyle, presets };
