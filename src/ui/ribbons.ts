// Default ribbon structures of the editors outside the layout editor
// (docs/validation/ui-gaps/workspace.md, "Ribbon customization").
// FlowJo 10.6.2 defaults: WSRibbonStructure.loadDefaults (FlowJo: Navigate,
// Experiment, Biology, Help; File: Document, Find; Edit: Clipboard, Select,
// Expand; Workspace: Groups, Populations, Statistics, Keywords; Tools:
// Cytometry, Biology, Boolean; Configure: Settings, Font, Power),
// TERibbonStructure (Table Editor: Tables, Iteration, Output; Edit: Columns;
// Visualize: Formatting, Plots) and PERibbonStructure (Plates: Plates,
// Experiment; File: Document; Edit: Clipboard, Select; Tools: Configure,
// Settings, Keywords). flowjo-rea's bands group the app's own controls, so
// band ids and the starting placement are the app's (own rule); the
// customisation rules are FlowJo's.
import type { RibbonSpec } from './RibbonConfig';

export const WS_RIBBON: RibbonSpec = {
  editor: 'ws',
  canCommit: true,
  bands: {
    navigate: 'Navigate / Experiment', document: 'Document', find: 'Find', clipboard: 'Clipboard', select: 'Select', expand: 'Expand',
    populations: 'Populations / Groups / Boolean', derived: 'Derived Parameters', statistics: 'Statistics', keywords: 'Keywords', columns: 'Columns / Sort', view: 'View',
    cytometry: 'Cytometry', biology: 'Experiment / Biology', settings: 'Settings',
  },
  defaults: {
    FlowJo: ['navigate'],
    File: ['document', 'find'],
    Edit: ['clipboard', 'select', 'expand'],
    Workspace: ['populations', 'derived', 'statistics', 'keywords', 'columns', 'view'],
    Tools: ['cytometry', 'biology'],
    Configure: ['settings'],
  },
};

// The table and plate editors show their bands in one strip (one task).
export const TE_RIBBON: RibbonSpec = {
  editor: 'te',
  canCommit: false, // TECommand has no Commit to Preferences constant
  bands: { formatting: 'Formatting', iteration: 'Iteration', output: 'Output', plots: 'Plots' },
  defaults: { 'Table Editor': ['formatting', 'iteration', 'output', 'plots'] },
};

export const PE_RIBBON: RibbonSpec = {
  editor: 'pe',
  canCommit: false, // PECommand has no Commit to Preferences constant
  bands: { plates: 'Plates', document: 'Document', clipboard: 'Clipboard', select: 'Select', experiment: 'Experiment', size: 'Plate size', settings: 'Settings' },
  defaults: { 'Plate Editor': ['plates', 'document', 'clipboard', 'select', 'experiment', 'size', 'settings'] },
};
