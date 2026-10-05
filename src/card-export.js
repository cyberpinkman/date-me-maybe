async function saveCard() {
  const x = current(),
    s = InviteModel.status(x),
    p = x.proposal;
  if (!p || s === "declined") {
    toast("先一起选好一个安排，再把小约定收好");
    return;
  }
  const openingView = view, previousModal = modal;
  const c = document.createElement("canvas"),
    q = c.getContext("2d");
  c.width = 900;
  function wrap(value, font, width = 650) {
    q.font = font;
    let lines = [""];
    for (const ch of Array.from(value)) {
      const last = lines.length - 1;
      if (q.measureText(lines[last] + ch).width > width) lines.push(ch);
      else lines[last] += ch;
    }
    return lines;
  }
  const rows = cardRows(x).map(([label, value]) => ({ label, lines: wrap(value, "28px sans-serif") }));
  const names = wrap(`${x.from}  &  ${x.to}`, "25px sans-serif");
  c.height =
    610 +
    rows.reduce((sum, row) => sum + 66 + row.lines.length * 39, 0) +
    170 +
    names.length * 34;
  const height = c.height;
  q.fillStyle = "#f9f0ee";
  q.fillRect(0, 0, 900, height);
  q.fillStyle = "#302b2c";
  q.beginPath();
  q.roundRect(69, 66, 772, height - 110, 28);
  q.fill();
  q.fillStyle = "#fffdfa";
  q.strokeStyle = "#302b2c";
  q.lineWidth = 4;
  q.beginPath();
  q.roundRect(55, 52, 772, height - 110, 28);
  q.fill();
  q.stroke();
  q.textAlign = "center";
  q.fillStyle = "#846974";
  q.font = "21px sans-serif";
  q.fillText("见一面  /  OUR LITTLE PROMISE", 450, 118);
  if (window.MASCOT_DATA) {
    const image = new Image();
    image.src = window.MASCOT_DATA;
    await image.decode();
    q.drawImage(image, 315, 143, 270, 270);
  }
  q.fillStyle = "#302b2c";
  q.font = "bold 44px sans-serif";
  q.fillText(
    s === "confirmed" ? "那就说好啦，到时候见。" : "一份想和你一起的小约定。",
    450,
    467,
  );
  q.fillStyle = s === "confirmed" ? "#52775d" : "#a55279";
  q.font = "24px sans-serif";
  q.fillText(s === "confirmed" ? "我们说好了" : statusText(x), 450, 515);
  q.textAlign = "left";
  let y = 593;
  for (const row of rows) {
    q.fillStyle = "#947b86";
    q.font = "18px sans-serif";
    q.fillText(row.label, 125, y);
    q.fillStyle = "#302b2c";
    q.font = "28px sans-serif";
    y += 43;
    for (const line of row.lines) {
      q.fillText(line, 125, y);
      y += 39;
    }
    y += 23;
  }
  q.textAlign = "center";
  q.fillStyle = "#846974";
  q.font = "25px sans-serif";
  names.forEach((name, i) => q.fillText(name, 450, y + 28 + i * 34));
  q.font = "20px sans-serif";
  q.fillText("见面这件小事，我们认真一点。", 450, y + 67 + names.length * 34);
  const card = await prepareCardAsset(c);
  if (current()?.id !== x.id || current()?.version !== x.version || view !== openingView || modal !== previousModal) {
    disposeCardExport(card);
    return;
  }
  disposeCardExport(modal);
  modal = card;
  renderModal();
}

async function prepareCardAsset(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("Card image encoding failed")), "image/jpeg", 0.95,
  ));
  const filename = "我们的小约定.jpg";
  const file = typeof File === "function" ? new File([blob], filename, { type: blob.type }) : null;
  return {
    type: "card", filename, file,
    // The visible image stays an image, preserving the browser's native long-press menu.
    data: canvas.toDataURL("image/jpeg", 0.95),
    imageUrl: URL.createObjectURL(blob),
    sharing: false,
  };
}

function canShareCardFile(file, platform = navigator) {
  if (!file || typeof platform.share !== "function" || typeof platform.canShare !== "function") return false;
  try { return platform.canShare({ files: [file] }); } catch { return false; }
}

async function sharePreparedCard(card, platform = navigator) {
  if (card.sharing) return "busy";
  if (!canShareCardFile(card.file, platform)) return "unsupported";
  card.sharing = true;
  try {
    // File preparation finishes before this click, retaining transient user activation.
    // Share only the image, never an owner URL or the invitation's access token.
    await platform.share({ files: [card.file] });
    return "shared";
  } catch (error) {
    return error?.name === "AbortError" ? "cancelled" : "failed";
  } finally { card.sharing = false; }
}

function disposeCardExport(card, urls) {
  if (card?.type === "card" && card.imageUrl) {
    (urls || URL).revokeObjectURL(card.imageUrl);
    card.imageUrl = null;
  }
}

function renderCardModal() {
  const card = modal, canShare = canShareCardFile(card.file);
  $("#modal-root").innerHTML = `<div class="modal-backdrop"><section class="modal card-save-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">把小约定收好。</h2><button class="close" data-action="close-modal" aria-label="关闭">×</button></div><p class="card-save-tip">手机上长按下方图片，选择保存图片。${canShare ? "也可以打开分享菜单，选择手机提供的保存方式。" : "如果没有出现保存选项，可以打开大图后再试试。"}</p><img class="card-save-image" src="${card.data}" alt="我们的小约定，长按图片保存" draggable="false">${canShare ? `<button class="btn primary wide" id="share-card-image">分享图片 ${icon("heart")}</button>` : ""}<a class="btn ${canShare ? "" : "primary"} wide card-open-image" href="${card.imageUrl}" target="_blank" rel="noopener">打开大图 ${icon("arrow")}</a><a class="text-btn card-download-image" href="${card.imageUrl}" download="${card.filename}">下载图片 ${icon("download")}</a><p id="card-share-status" class="hint" role="status" aria-live="polite"></p></section></div>`;
  $("#modal-root").querySelector('[data-action="close-modal"]').addEventListener("click", closeModal);
  $("#share-card-image")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await sharePreparedCard(card);
    button.disabled = false;
    if (modal !== card) return;
    $("#card-share-status").textContent = ["failed", "unsupported"].includes(result)
      ? "暂时没能打开分享菜单，试试长按图片，或打开大图保存。" : "";
  });
  $("#modal-root").querySelector("button").focus();
}

if (typeof module !== "undefined") module.exports = { prepareCardAsset, canShareCardFile, sharePreparedCard, disposeCardExport };
