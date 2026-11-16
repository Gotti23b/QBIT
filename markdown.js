(() => {
  "use strict";
  const inlineToken = /(\x60+)([\s\S]+?)\1|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|(https?:\/\/[^\s<]+)|(\*\*|__)(?=\S)([\s\S]+?)\6|(\*|_)(?=\S)([\s\S]+?)\8|~~([\s\S]+?)~~/g;

  function appendInline(parent, source) {
    const text = String(source ?? "");
    let cursor = 0;
    const tokens = new RegExp(inlineToken.source, "g");
    let match;
    while ((match = tokens.exec(text))) {
      if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
      let node;
      if (match[1]) {
        node = document.createElement("code");
        node.textContent = match[2];
      } else if (match[3]) {
        node = document.createElement("a");
        node.textContent = match[3];
        node.href = match[4];
        node.target = "_blank";
        node.rel = "noopener noreferrer";
      } else if (match[5]) {
        node = document.createElement("a");
        node.textContent = match[5];
        node.href = match[5].replace(/[.,!?;:]+$/, "");
        node.target = "_blank";
        node.rel = "noopener noreferrer";
        const trailing = match[5].slice(node.href.length);
        parent.append(node);
        if (trailing) parent.append(document.createTextNode(trailing));
        cursor = tokens.lastIndex;
        continue;
      } else if (match[6]) {
        node = document.createElement("strong");
        appendInline(node, match[7]);
      } else if (match[8]) {
        node = document.createElement("em");
        appendInline(node, match[9]);
      } else {
        node = document.createElement("del");
        appendInline(node, match[10]);
      }
      parent.append(node);
      cursor = tokens.lastIndex;
    }
    if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
  }

  function splitTableRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
    return value.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
  }
  function isTableStart(lines, index) {
    return index + 1 < lines.length && lines[index].includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
  }
  function appendTable(root, lines, start) {
    const headers = splitTableRow(lines[start]);
    const alignments = splitTableRow(lines[start + 1]).map(cell =>
      cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
    const wrap = document.createElement("div");
    wrap.className = "markdown-table-wrap";
    const table = document.createElement("table");
    table.className = "markdown-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((value, column) => {
      const cell = document.createElement("th");
      cell.style.textAlign = alignments[column] || "left";
      appendInline(cell, value);
      headRow.append(cell);
    });
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    let index = start + 2;
    while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
      const values = splitTableRow(lines[index]);
      const row = document.createElement("tr");
      headers.forEach((_, column) => {
        const cell = document.createElement("td");
        cell.style.textAlign = alignments[column] || "left";
        appendInline(cell, values[column] || "");
        row.append(cell);
      });
      tbody.append(row);
      index++;
    }
    table.append(tbody);
    wrap.append(table);
    root.append(wrap);
    return index;
  }

  function appendFence(root, lines, start) {
    const opening = lines[start].match(/^\s*(\x60{3,}|~{3,})\s*([^\s\x60]*)?.*$/);
    const fence = opening?.[1] || "\x60\x60\x60";
    const language = (opening?.[2] || "").trim();
    const code = [];
    let index = start + 1;
    const close = new RegExp("^\\s*" + fence[0] + "{" + fence.length + ",}\\s*$");
    while (index < lines.length && !close.test(lines[index])) code.push(lines[index++]);
    if (index < lines.length) index++;
    const box = document.createElement("section");
    box.className = "codeblock";
    const header = document.createElement("div");
    header.className = "codehead";
    const label = document.createElement("span");
    label.className = "code-language";
    label.textContent = language || "código";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "small code-copy";
    copy.textContent = "Copiar";
    const value = code.join("\n");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value);
        copy.textContent = "Copiado";
      } catch {
        copy.textContent = "No disponible";
      }
      window.setTimeout(() => { copy.textContent = "Copiar"; }, 1400);
    });
    const pre = document.createElement("pre");
    const codeElement = document.createElement("code");
    if (language) codeElement.dataset.language = language;
    codeElement.textContent = value;
    pre.append(codeElement);
    header.append(label, copy);
    box.append(header, pre);
    root.append(box);
    return index;
  }

  function appendList(root, lines, start, depth = 0) {
    const first = lines[start].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    const ordered = /^\d/.test(first[2]);
    const baseIndent = first[1].replace(/\t/g, "    ").length;
    const list = document.createElement(ordered ? "ol" : "ul");
    if (ordered) {
      const number = Number(first[2].replace(/[.)]/, ""));
      if (number > 1) list.start = number;
    }
    if (depth) list.className = "markdown-nested-list";
    let index = start;
    while (index < lines.length) {
      const match = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!match) break;
      const indent = match[1].replace(/\t/g, "    ").length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        const last = list.lastElementChild;
        if (!last) break;
        index = appendList(last, lines, index, depth + 1);
        continue;
      }
      if (/^\d/.test(match[2]) !== ordered) break;
      const item = document.createElement("li");
      let content = match[3];
      const task = content.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.disabled = true;
        checkbox.checked = task[1].toLowerCase() === "x";
        checkbox.className = "markdown-task-checkbox";
        item.classList.add("markdown-task-item");
        item.append(checkbox);
        content = task[2];
      }
      const body = document.createElement("span");
      body.className = "markdown-list-content";
      appendInline(body, content);
      item.append(body);
      list.append(item);
      index++;
      if (index < lines.length && /^\s*$/.test(lines[index])) {
        const next = lines[index + 1] || "";
        const nextList = next.match(/^(\s*)([-*+]|\d+[.)])\s+/);
        if (nextList && nextList[1].replace(/\t/g, "    ").length > baseIndent) {
          index++;
          index = appendList(item, lines, index, depth + 1);
        }
      }
    }
    root.append(list);
    return index;
  }

  function renderBlocks(source, root) {
    const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
    let index = 0;
    const startsBlock = line =>
      /^\s*(\x60{3,}|~{3,})/.test(line) ||
      /^ {0,3}#{1,6}\s/.test(line) ||
      /^ {0,3}>\s?/.test(line) ||
      /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
      /^\s*([-*+]|\d+[.)])\s+/.test(line);
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index++; continue; }
      if (/^\s*(\x60{3,}|~{3,})/.test(line)) { index = appendFence(root, lines, index); continue; }
      if (isTableStart(lines, index)) { index = appendTable(root, lines, index); continue; }
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const element = document.createElement("h" + heading[1].length);
        appendInline(element, heading[2]);
        root.append(element);
        index++;
        continue;
      }
      if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        root.append(document.createElement("hr"));
        index++;
        continue;
      }
      if (/^ {0,3}>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^ {0,3}>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^ {0,3}>\s?/, ""));
          index++;
        }
        const quote = document.createElement("blockquote");
        renderBlocks(quoteLines.join("\n"), quote);
        root.append(quote);
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        index = appendList(root, lines, index);
        continue;
      }
      const paragraph = document.createElement("p");
      const parts = [];
      while (index < lines.length && lines[index].trim() &&
        !(parts.length && startsBlock(lines[index])) && !isTableStart(lines, index)) {
        parts.push(lines[index].trim());
        index++;
      }
      appendInline(paragraph, parts.join(" "));
      root.append(paragraph);
    }
  }
  function render(text) {
    const root = document.createElement("div");
    root.className = "markdown-content";
    renderBlocks(text, root);
    return root;
  }
  window.QBITMarkdown = Object.freeze({ render });
})();