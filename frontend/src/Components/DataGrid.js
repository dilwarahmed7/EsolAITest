import React from 'react';
import './DataGrid.css';

function DataGrid({
  columns = [],
  rows = [],
  loading = false,
  loadingMessage = 'Loading…',
  emptyMessage = 'No records found.',
  className = '',
}) {
  const gridTemplate = columns.map((c) => c.width || '1fr').join(' ');
  const baseRowStyle = { gridTemplateColumns: gridTemplate };

  const renderMessageRow = (text, key) => (
    <div className="data-grid-row muted" style={{ gridTemplateColumns: '1fr' }} key={key}>
      <div className="data-grid-cell">{text}</div>
    </div>
  );

  const renderDataRow = (row, rowIndex) => {
    const { cells = [], key, className: rowClass, onDoubleClick } = row;
    const rowKey = key ?? rowIndex;
    return (
      <div
        className={`data-grid-row ${rowClass || ''}`.trim()}
        style={baseRowStyle}
        key={rowKey}
        onDoubleClick={onDoubleClick}
      >
        {cells.map((cell, cellIndex) => {
          const col = columns[cellIndex] || {};
          const align = col.align ? ` align-${col.align}` : '';
          return (
            <div className={`data-grid-cell${align}`} key={`${rowKey}-${cellIndex}`}>
              {cell}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`data-grid ${className}`.trim()}>
      <div className="data-grid-head" style={baseRowStyle}>
        {columns.map((col, idx) => (
          <div
            className={`data-grid-cell${col.align ? ` align-${col.align}` : ''}`}
            key={col.key || col.title || idx}
          >
            {col.title}
          </div>
        ))}
      </div>
      <div className="data-grid-body">
        {loading
          ? renderMessageRow(loadingMessage, 'loading')
          : rows.length === 0
          ? renderMessageRow(emptyMessage, 'empty')
          : rows.map(renderDataRow)}
      </div>
    </div>
  );
}

export default DataGrid;
