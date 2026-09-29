export const styles = `
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 0;
    margin: 0;
  }
  .panel {
    padding: 14px 12px 24px;
  }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 14px;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--vscode-descriptionForeground);
    display: inline-block;
    flex-shrink: 0;
  }
  .status-dot--running {
    background: var(--vscode-charts-blue, #3794ff);
  }
  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .notification {
    font-size: 12px;
    background: var(--vscode-inputValidation-infoBackground, rgba(255,255,255,0.05));
    border: 1px solid var(--vscode-inputValidation-infoBorder, transparent);
    padding: 6px 8px;
    border-radius: 4px;
    margin-bottom: 10px;
  }
  .empty {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    padding: 8px 0;
  }
  .plan {
    border: 1px solid var(--vscode-widget-border, transparent);
    background: var(--vscode-sideBar-background);
    border-radius: 8px;
    padding: 14px;
  }
  .plan-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
    margin-bottom: 8px;
  }
  .progress-track {
    height: 5px;
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 3px;
    margin-bottom: 12px;
  }
  .progress-fill {
    height: 5px;
    background: var(--vscode-progressBar-background, #0078d4);
    border-radius: 3px;
    transition: width 0.2s ease;
  }
  .plan-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .plan-item {
    display: flex;
    gap: 8px;
    font-size: 13px;
    align-items: baseline;
    color: var(--vscode-descriptionForeground);
  }
  .plan-item--completed {
    text-decoration: line-through;
    opacity: 0.7;
  }
  .plan-item--in_progress {
    color: var(--vscode-foreground);
    font-weight: 600;
  }
  .plan-item-icon {
    width: 14px;
    flex-shrink: 0;
  }
  .summary {
    margin-top: 12px;
    border: 1px solid var(--vscode-widget-border, transparent);
    background: var(--vscode-sideBar-background);
    border-radius: 8px;
    padding: 14px;
  }
  .summary-header {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .summary-body {
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .summary-body--collapsed {
    max-height: 190px;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
    mask-image: linear-gradient(to bottom, #000 70%, transparent);
  }
  .summary-toggle {
    margin-top: 8px;
    padding: 0;
    border: none;
    background: none;
    color: var(--vscode-textLink-foreground);
    font-size: 12px;
    cursor: pointer;
  }
  .summary-toggle:hover {
    text-decoration: underline;
  }
  .md > :first-child {
    margin-top: 0;
  }
  .md > :last-child {
    margin-bottom: 0;
  }
  .md p {
    margin: 6px 0;
  }
  .md-heading {
    font-weight: 600;
    margin: 12px 0 4px;
  }
  .md ul, .md ol {
    margin: 4px 0;
    padding-left: 18px;
  }
  .md li {
    margin: 2px 0;
  }
  .md code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
    padding: 1px 4px;
    border-radius: 3px;
  }
  .md-code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 6px 0;
  }
  .md-link {
    color: var(--vscode-textLink-foreground);
  }
`;
