/**
 * アイコン画像の切り抜き。写真を選び、指でずらす(1本指)・広げる(2本指)か、
 * スライダーで大きさを変えて、正方形に切り抜く。180px と 192px の PNG を作って保存する。
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { IconTargetInfo, IconUploadRequest } from "../../shared/api-types";
import { apiJson } from "../api";
import { errorMessage } from "./common";
import { MAX_ZOOM, cropRect, initialCrop, panCrop, setZoom, zoomOf, type CropState } from "./crop";

const VIEW_SIZE = 260;

function renderPng(image: HTMLImageElement, crop: CropState, size: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const { sx, sy, size: side } = cropRect(crop);
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

export function IconEditor({ target, onClose }: { target: IconTargetInfo; onClose: (saved: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 切り抜き範囲が変わるたびに、表示枠に描き直す
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !crop) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = VIEW_SIZE * scale;
    canvas.height = VIEW_SIZE * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    const { sx, sy, size } = cropRect(crop);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
  }, [image, crop]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setCrop(initialCrop(img.naturalWidth, img.naturalHeight));
      setMessage(null);
    };
    img.onerror = () => setMessage("この画像は読み込めませんでした。別の画像を選んでください。");
    img.src = url;
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev || !image || !crop) return;
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (map.size === 1) {
      setCrop(panCrop(crop, e.clientX - prev.x, e.clientY - prev.y, VIEW_SIZE, w, h));
    } else if (map.size === 2) {
      // 2本指: 指の間の距離の変化で拡大・縮小する
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0) setCrop(setZoom(crop, zoomOf(crop, w, h) * (after / before), w, h));
      }
    }
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const save = async () => {
    if (!image || !crop) return;
    setBusy(true);
    setMessage(null);
    try {
      const body: IconUploadRequest = { png180: renderPng(image, crop, 180), png192: renderPng(image, crop, 192) };
      await apiJson(`/api/core/icons/${target.id}`, { method: "PUT", body: JSON.stringify(body) });
      onClose(true);
    } catch (error) {
      setMessage(errorMessage(error));
      setBusy(false);
    }
  };

  const zoom = image && crop ? zoomOf(crop, image.naturalWidth, image.naturalHeight) : 1;
  return (
    <div className="icon-editor">
      <h3>「{target.name}」のアイコン</h3>
      <label className="file-button">
        {image ? "別の画像を選ぶ" : "画像を選ぶ"}
        <input type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0])} />
      </label>
      {image && crop && (
        <>
          <p className="note">1本指でずらす、2本指で広げる・縮める、または下のスライダーで大きさを調整します。</p>
          <canvas
            ref={canvasRef}
            className="icon-editor__view"
            style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <label className="icon-editor__zoom">
            大きさ
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setCrop(setZoom(crop, Number(e.target.value), image.naturalWidth, image.naturalHeight))}
            />
          </label>
        </>
      )}
      {message && <p className="message message--error">{message}</p>}
      <div className="buttons">
        <button type="button" disabled={busy || !image} onClick={save}>
          この範囲で保存
        </button>
        <button type="button" className="button--secondary" disabled={busy} onClick={() => onClose(false)}>
          やめる
        </button>
      </div>
    </div>
  );
}
