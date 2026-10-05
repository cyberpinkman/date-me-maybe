const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareCardAsset, canShareCardFile, sharePreparedCard, disposeCardExport } = require("../src/card-export.js");

test("card preparation produces a shareable image file and a native image URL with explicit disposal", async () => {
  const blob = new Blob(["encoded-image"], { type: "image/jpeg" });
  const canvas = {
    toBlob(callback, type) { assert.equal(type, "image/jpeg"); callback(blob); },
    toDataURL(type) { assert.equal(type, "image/jpeg"); return "data:image/jpeg;base64,aW1hZ2U="; },
  };
  const card = await prepareCardAsset(canvas);
  assert.equal(card.file.type, "image/jpeg");
  assert.equal(card.file.name, "我们的小约定.jpg");
  assert.equal(await card.file.text(), "encoded-image");
  assert.match(card.data, /^data:image\/jpeg;/);
  assert.match(card.imageUrl, /^blob:/);
  assert.equal(await (await fetch(card.imageUrl)).text(), "encoded-image");
  const url = card.imageUrl;
  disposeCardExport(card);
  assert.equal(card.imageUrl, null);
  disposeCardExport(card);
  disposeCardExport({ type: "change" });
  await assert.rejects(fetch(url));
  await assert.rejects(prepareCardAsset({ toBlob(callback) { callback(null); } }), /encoding failed/);
});

test("file sharing starts synchronously from the click with only prepared image data and cannot overlap", async () => {
  const card = { file: new File(["image"], "约定.jpg", { type: "image/jpeg" }), sharing: false };
  let complete, count = 0;
  const platform = {
    canShare: data => data.files[0] === card.file,
    share(data) {
      assert.deepEqual(Object.keys(data), ["files"], "Never send an owner URL or invitation capability");
      assert.equal(data.files[0], card.file);
      count++;
      return new Promise(resolve => { complete = resolve; });
    },
  };
  const pending = sharePreparedCard(card, platform);
  assert.equal(count, 1, "Native sharing must begin before any asynchronous delay loses user activation");
  assert.equal(await sharePreparedCard(card, platform), "busy");
  assert.equal(count, 1);
  complete();
  assert.equal(await pending, "shared");
  assert.equal(card.sharing, false);
});

test("unavailable sharing, cancellation and platform failures retain the image for long-press saving", async () => {
  const file = new File(["image"], "约定.jpg", { type: "image/jpeg" });
  for (const platform of [{}, { share() {} }, { share() {}, canShare: () => false }, { share() {}, canShare() { throw new Error("unsupported"); } }]) {
    assert.equal(canShareCardFile(file, platform), false);
    assert.equal(await sharePreparedCard({ file }, platform), "unsupported");
  }
  for (const [name, result] of [["AbortError", "cancelled"], ["NotAllowedError", "failed"], ["DataError", "failed"]]) {
    const card = { file, data: "image-preview", imageUrl: "blob:still-available" };
    assert.equal(await sharePreparedCard(card, { canShare: () => true, share() { throw Object.assign(new Error("native message"), { name }); } }), result);
    assert.equal(card.data, "image-preview");
    assert.equal(card.imageUrl, "blob:still-available");
    assert.equal(card.sharing, false);
  }
});
