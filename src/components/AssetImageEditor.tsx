import { ArrowDown, ArrowUp, Image as ImageIcon, Link2, Star, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { libraryApi } from '../api/client';
import type { AssetImageUpdateInput } from '../api/contracts';
import { assetImageUrl, coverAdvice, coverObjectPosition, formatImageSize } from '../lib/asset-images';
import type { AssetImage, LibraryAsset } from '../types/library';

/** Mirrors the server's hard cap so oversized files fail before the upload starts. */
export const MAX_LOCAL_IMAGE_BYTES = 1024 * 1024;

const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function AssetImageEditor({ asset }: { asset: LibraryAsset }) {
  const [images, setImages] = useState<AssetImage[]>(asset.images ?? []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [focalTarget, setFocalTarget] = useState<AssetImage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setImages(await libraryApi.listAssetImages(asset.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Images could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [asset.id]);

  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<void>, fallbackMessage: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); }
    catch (workError) { setError(workError instanceof Error ? workError.message : fallbackMessage); }
    finally { setBusy(false); }
  };

  const upload = async (file: File, kind: 'cover' | 'gallery') => {
    if (!acceptedTypes.includes(file.type)) {
      setError('Orbis accepts JPEG, PNG, WebP and GIF images only.');
      return;
    }
    if (file.size > MAX_LOCAL_IMAGE_BYTES) {
      setError(`Orbis stores images up to ${MAX_LOCAL_IMAGE_BYTES / 1024} KB each. That file is ${formatImageSize(file.size)}.`);
      return;
    }
    await run(async () => {
      const created = await libraryApi.uploadAssetImage(asset.id, { kind, file, altText: asset.name });
      setImages((current) => sortImages([...current, created]));
      setMessage(kind === 'cover' ? 'Cover artwork saved.' : 'Gallery image saved.');
    }, 'The image could not be uploaded.');
  };

  const addExternal = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = externalUrl.trim();
    if (!url) return;
    await run(async () => {
      const created = await libraryApi.addExternalAssetImage(asset.id, { kind: 'gallery', url, altText: asset.name });
      setImages((current) => sortImages([...current, created]));
      setExternalUrl('');
      setMessage('External image linked.');
    }, 'The external image could not be linked.');
  };

  const update = async (image: AssetImage, changes: AssetImageUpdateInput, confirmMessage?: string) => {
    await run(async () => {
      const updated = await libraryApi.updateAssetImage(asset.id, image.id, changes);
      setImages((current) => sortImages(current.map((item) => item.id === updated.id ? updated : item)));
      if (confirmMessage) setMessage(confirmMessage);
    }, 'The image could not be updated.');
  };

  const remove = async (image: AssetImage) => {
    if (!window.confirm('Remove this image from this record? The file is deleted from Orbis storage.')) return;
    await run(async () => {
      await libraryApi.removeAssetImage(asset.id, image.id);
      setImages((current) => sortImages(current.filter((item) => item.id !== image.id)));
      setMessage('Image removed.');
    }, 'The image could not be removed.');
  };

  const move = async (image: AssetImage, direction: -1 | 1) => {
    const gallery = images.filter((item) => item.kind === 'gallery').sort((a, b) => a.position - b.position);
    const index = gallery.findIndex((item) => item.id === image.id);
    const swapWith = gallery[index + direction];
    if (!swapWith) return;
    await run(async () => {
      const [moved, other] = await Promise.all([
        libraryApi.updateAssetImage(asset.id, image.id, { position: swapWith.position }),
        libraryApi.updateAssetImage(asset.id, swapWith.id, { position: image.position }),
      ]);
      setImages((current) => sortImages(current.map((item) => item.id === moved.id ? moved : item.id === other.id ? other : item)));
    }, 'The gallery order could not be changed.');
  };

  const cover = images.find((image) => image.kind === 'cover');
  const gallery = images.filter((image) => image.kind === 'gallery').sort((a, b) => a.position - b.position);
  const advice = coverAdvice(cover);

  const pickFocalPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!focalTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const focalX = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
    const focalY = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);
    setFocalTarget({ ...focalTarget, focalX, focalY });
  };

  const commitFocalPoint = async () => {
    if (!focalTarget) return;
    const target = focalTarget;
    setFocalTarget(null);
    await update(target, { focalX: target.focalX, focalY: target.focalY }, 'Focal point saved.');
  };

  return (
    <section className="asset-images editor-panel" aria-labelledby="asset-images-heading">
      <div className="asset-images__head">
        <div>
          <span className="eyebrow">Artwork</span>
          <h2 id="asset-images-heading">Cover &amp; gallery</h2>
          <p className="asset-images__hint">Local uploads are capped at 1 MB each and stored on Orbis' disk, never in the database. JPEG, PNG, WebP and GIF.</p>
        </div>
      </div>

      {message && <p className="asset-images__notice" role="status">{message}</p>}
      {error && <p className="asset-images__notice is-error" role="alert">{error}</p>}

      <div className="asset-images__cover">
        <div
          className="asset-images__cover-frame"
          onClick={pickFocalPoint}
          role={focalTarget ? 'button' : undefined}
          tabIndex={focalTarget ? 0 : -1}
          aria-label={focalTarget ? 'Click to set the focal point' : undefined}
        >
          {cover
            ? <img src={assetImageUrl(cover)} alt="" style={{ objectPosition: coverObjectPosition(focalTarget?.id === cover.id ? focalTarget : cover) }} />
            : <div className="asset-images__empty"><ImageIcon size={20} /><span>No cover yet. Cards keep the generated tone artwork until you add one.</span></div>}
          {focalTarget && focalTarget.id === cover?.id && <span className="asset-images__focal-marker" style={{ left: `${focalTarget.focalX * 100}%`, top: `${focalTarget.focalY * 100}%` }} />}
        </div>
        <div className="asset-images__cover-side">
          <h3>Cover artwork</h3>
          <p>Card artwork is cropped at 16:9 and never stretched. 1600x900 or 1280x720 keeps the whole frame.</p>
          {advice && <p className="asset-images__advice">{advice}</p>}
          {cover && <>
            <p className="asset-images__meta">{cover.width && cover.height ? `${cover.width}x${cover.height} · ` : ''}{formatImageSize(cover.byteSize)} · {cover.storageKind === 'external' ? 'external URL' : 'Orbis upload'}</p>
            {focalTarget?.id === cover.id
              ? <div className="asset-images__actions"><button type="button" className="button button--primary" disabled={busy} onClick={() => void commitFocalPoint()}>Save focal point</button><button type="button" className="button button--secondary" onClick={() => setFocalTarget(null)}>Cancel</button></div>
              : <div className="asset-images__actions">
                <button type="button" className="button button--secondary" disabled={busy} onClick={() => setFocalTarget(cover)}>Set focal point</button>
                <button type="button" className="button button--secondary" disabled={busy} onClick={() => void update(cover, { kind: 'gallery' }, 'Cover removed.')}>Remove cover</button>
                <button type="button" className="button button--danger" disabled={busy} onClick={() => void remove(cover)}><Trash2 size={15} /> Delete</button>
              </div>}
            <ImageFields image={cover} disabled={busy} onSave={(changes) => void update(cover, changes, 'Cover details saved.')} />
          </>}
          {!cover && <div className="asset-images__actions">
            <button type="button" className="button button--primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} /> Upload cover</button>
            <span className="asset-images__meta">or promote a gallery image below</span>
          </div>}
        </div>
      </div>

      <div className="asset-images__gallery">
        <header><h3>Gallery</h3><span>{gallery.length} image{gallery.length === 1 ? '' : 's'}</span></header>
        {loading && <p className="asset-images__meta">Loading images...</p>}
        {!loading && gallery.length === 0 && <p className="asset-images__meta">No gallery images yet. Gallery images keep their own aspect ratio and are never cropped to 16:9.</p>}
        <ul>
          {gallery.map((image, index) => <li key={image.id}>
            <img className="asset-images__thumb" src={assetImageUrl(image)} alt="" loading="lazy" />
            <div className="asset-images__item-body">
              <ImageFields image={image} disabled={busy} onSave={(changes) => void update(image, changes, 'Image details saved.')} />
              <div className="asset-images__actions">
                <button type="button" className="button button--secondary" disabled={busy || index === 0} onClick={() => void move(image, -1)} aria-label="Move image earlier"><ArrowUp size={15} /></button>
                <button type="button" className="button button--secondary" disabled={busy || index === gallery.length - 1} onClick={() => void move(image, 1)} aria-label="Move image later"><ArrowDown size={15} /></button>
                <button type="button" className="button button--secondary" disabled={busy} onClick={() => void update(image, { kind: 'cover' }, 'That image is now the cover.')}><Star size={15} /> Make cover</button>
                <button type="button" className="button button--danger" disabled={busy} onClick={() => void remove(image)}><Trash2 size={15} /> Remove</button>
              </div>
            </div>
          </li>)}
        </ul>
        <div className="asset-images__add">
          <button type="button" className="button button--primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} /> Upload gallery image</button>
          <form className="asset-images__external" onSubmit={addExternal}>
            <label className="editor-field"><span>External image URL</span><input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://..." /></label>
            <button type="submit" className="button button--secondary" disabled={busy || !externalUrl.trim()}><Link2 size={15} /> Link image</button>
          </form>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={acceptedTypes.join(',')}
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file, 'gallery');
        }}
      />
    </section>
  );
}

function ImageFields({ image, disabled, onSave }: { image: AssetImage; disabled: boolean; onSave: (changes: AssetImageUpdateInput) => void }) {
  const [caption, setCaption] = useState(image.caption ?? '');
  const [altText, setAltText] = useState(image.altText ?? '');
  useEffect(() => { setCaption(image.caption ?? ''); setAltText(image.altText ?? ''); }, [image.id, image.caption, image.altText]);
  const dirty = caption !== (image.caption ?? '') || altText !== (image.altText ?? '');
  return <div className="asset-images__fields">
    <label className="editor-field"><span>Caption</span><input value={caption} maxLength={300} onChange={(event) => setCaption(event.target.value)} /></label>
    <label className="editor-field"><span>Alt text</span><input value={altText} maxLength={300} onChange={(event) => setAltText(event.target.value)} placeholder="Describe the image for screen readers" /></label>
    {dirty && <button type="button" className="button button--secondary" disabled={disabled} onClick={() => onSave({ caption: caption || null, altText: altText || null })}>Save details</button>}
  </div>;
}

function sortImages(images: AssetImage[]) {
  return [...images].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'cover' ? -1 : 1;
    return a.position - b.position;
  });
}
