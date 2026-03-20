import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Folder, FileText, RefreshCw, Save, PlusCircle, FolderPlus, Upload } from 'lucide-react';
import {
  listRemoteFiles,
  readRemoteFile,
  writeRemoteFile,
  createRemoteFile,
  createRemoteDirectory,
  uploadRemoteFiles
} from '../services/backendService';
import './RemoteFilesPage.css';

const DEFAULT_ROOT = '/etc/zabbix';

const resolvePreferredSSHHost = (host) => {
  const ip = (host?.ip || '').trim();
  return ip && ip.toUpperCase() !== 'N/A' ? ip : (host?.hostname || '');
};

const RemoteFilesPage = ({ hosts = [], preferredHost = null }) => {
  const hostOptions = useMemo(
    () => hosts.filter((h) => resolvePreferredSSHHost(h)).sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [hosts]
  );

  const [connection, setConnection] = useState({
    host: '',
    sshPort: '22',
    sshUser: '',
    sshPassword: ''
  });
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileMeta, setFileMeta] = useState({ mtime: null, size: 0, mode: '' });
  const [selectedUploadHostIds, setSelectedUploadHostIds] = useState([]);
  const [bulkUploadPath, setBulkUploadPath] = useState('');
  const fileUploadInputRef = useRef(null);
  const folderUploadInputRef = useRef(null);

  useEffect(() => {
    if (!preferredHost) return;

    setConnection((prev) => ({
      ...prev,
      host: resolvePreferredSSHHost(preferredHost)
    }));
  }, [preferredHost]);

  const runList = async (relativePath = '') => {
    setLoadingList(true);
    try {
      const data = await listRemoteFiles({
        ...connection,
        sshPort: Number(connection.sshPort),
        relativePath
      });
      setCurrentPath(data.currentPath || '');
      setBulkUploadPath(data.currentPath || '');
      setItems(data.items || []);
      setConnected(true);
    } catch (error) {
      toast.error(`Cannot list files: ${error.message}`);
    } finally {
      setLoadingList(false);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!connection.host || !connection.sshUser) {
      toast.error('Host and SSH user are required');
      return;
    }

    setSelectedFile('');
    setFileContent('');
    setDirty(false);
    await runList('');
  };

  const openFolder = async (item) => {
    if (item.type !== 'directory') return;
    await runList(item.relativePath);
  };

  const goUp = async () => {
    if (!currentPath) return;
    const parentPath = currentPath.includes('/')
      ? currentPath.slice(0, currentPath.lastIndexOf('/'))
      : '';
    await runList(parentPath);
  };

  const openFile = async (item) => {
    if (dirty) {
      const proceed = window.confirm('You have unsaved changes. Continue and discard them?');
      if (!proceed) return;
    }

    try {
      const data = await readRemoteFile({
        ...connection,
        sshPort: Number(connection.sshPort),
        relativePath: item.relativePath
      });
      setSelectedFile(data.relativePath);
      setFileContent(data.content || '');
      setFileMeta(data.metadata || { mtime: null, size: 0, mode: '' });
      setDirty(false);
    } catch (error) {
      toast.error(`Cannot open file: ${error.message}`);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;

    setSaving(true);
    try {
      const data = await writeRemoteFile({
        ...connection,
        sshPort: Number(connection.sshPort),
        relativePath: selectedFile,
        content: fileContent,
        previousMtime: fileMeta.mtime
      });
      setFileMeta(data.metadata || fileMeta);
      setDirty(false);
      toast.success(`Saved ${selectedFile}`);
      await runList(currentPath);
    } catch (error) {
      toast.error(`Save failed: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const createFile = async () => {
    const fileName = window.prompt('New file name (e.g., custom.conf):');
    if (!fileName) return;

    try {
      const data = await createRemoteFile({
        ...connection,
        sshPort: Number(connection.sshPort),
        directoryPath: currentPath,
        fileName,
        content: ''
      });
      toast.success(`Created ${fileName}`);
      await runList(currentPath);

      setSelectedFile(data.relativePath);
      setFileContent('');
      setFileMeta(data.metadata || { mtime: null, size: 0, mode: '' });
      setDirty(false);
    } catch (error) {
      toast.error(`Create failed: ${error.message}`);
    }
  };

  const createDirectory = async () => {
    const folderName = window.prompt('New folder name (e.g., conf.d):');
    if (!folderName) return;

    try {
      await createRemoteDirectory({
        ...connection,
        sshPort: Number(connection.sshPort),
        directoryPath: currentPath,
        folderName
      });

      toast.success(`Created folder ${folderName}`);
      await runList(currentPath);
    } catch (error) {
      toast.error(`Create folder failed: ${error.message}`);
    }
  };

  const toggleUploadHost = (hostId) => {
    setSelectedUploadHostIds((prev) => (
      prev.includes(hostId)
        ? prev.filter((id) => id !== hostId)
        : [...prev, hostId]
    ));
  };

  const selectAllUploadHosts = () => {
    setSelectedUploadHostIds(hostOptions.map((host) => String(host.id ?? host.hostname)));
  };

  const clearUploadHosts = () => {
    setSelectedUploadHostIds([]);
  };

  const resolveUploadTargets = () => {
    if (selectedUploadHostIds.length > 0) {
      return hostOptions
        .filter((host) => selectedUploadHostIds.includes(String(host.id ?? host.hostname)))
        .map((host) => resolvePreferredSSHHost(host))
        .filter(Boolean);
    }

    return connection.host ? [connection.host] : [];
  };

  const normalizeUploadPath = (value) => String(value || '').trim().replace(/^\/+/, '');

  const handleUpload = async (files, isFolderUpload = false) => {
    if (!connection.sshUser) {
      toast.error('SSH user is required for upload');
      return;
    }

    if (!files.length) return;

    const targets = resolveUploadTargets();
    if (targets.length === 0) {
      toast.error('Select at least one target host or set SSH host');
      return;
    }

    const targetDirectory = normalizeUploadPath(bulkUploadPath || currentPath || '');

    const toastId = toast.loading(`Uploading ${files.length} file(s) to 1/${targets.length} host(s)...`);
    const failures = [];
    let successCount = 0;

    setUploading(true);
    try {
      for (let i = 0; i < targets.length; i++) {
        const targetHost = targets[i];
        toast.loading(`Uploading to ${i + 1}/${targets.length}: ${targetHost}`, { id: toastId });

        const formData = new FormData();
        formData.append('host', targetHost);
        formData.append('sshPort', String(Number(connection.sshPort) || 22));
        formData.append('sshUser', connection.sshUser);
        formData.append('sshPassword', connection.sshPassword || '');
        formData.append('directoryPath', targetDirectory);

        files.forEach((file) => {
          const relativePath = isFolderUpload && file.webkitRelativePath
            ? file.webkitRelativePath
            : file.name;
          formData.append('files', file, file.name);
          formData.append('relativePaths', relativePath);
        });

        try {
          await uploadRemoteFiles(formData);
          successCount += 1;
        } catch (error) {
          failures.push({ host: targetHost, message: error.message });
        }
      }

      if (failures.length === 0) {
        toast.success(
          `Uploaded ${files.length} file(s) to ${successCount}/${targets.length} host(s) at ${DEFAULT_ROOT}${targetDirectory ? `/${targetDirectory}` : ''}`,
          { id: toastId }
        );
      } else {
        const failureSummary = failures
          .slice(0, 3)
          .map((item) => `${item.host}: ${item.message}`)
          .join(' | ');

        toast.error(
          `Upload finished with failures (${successCount}/${targets.length} hosts succeeded)`,
          { id: toastId, description: failureSummary }
        );
      }

      await runList(currentPath);
    } catch (error) {
      toast.error(`Upload failed: ${error.message}`, { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const onFileUploadChange = async (event) => {
    const files = Array.from(event.target.files || []);
    await handleUpload(files, false);
    event.target.value = '';
  };

  const onFolderUploadChange = async (event) => {
    const files = Array.from(event.target.files || []);
    await handleUpload(files, true);
    event.target.value = '';
  };

  const onHostChange = (hostId) => {
    const host = hostOptions.find((h) => String(h.id) === hostId);
    if (!host) return;

    setConnection((prev) => ({
      ...prev,
      host: resolvePreferredSSHHost(host)
    }));
  };

  return (
    <div className="remote-files-page">
      <div className="remote-files-header">
        <h1>Remote File Manager</h1>
        <p>Browse and edit files under {DEFAULT_ROOT} through SSH.</p>
      </div>

      <form className="ssh-panel" onSubmit={handleConnect}>
        <div className="field">
          <label>Host from inventory</label>
          <select onChange={(e) => onHostChange(e.target.value)} defaultValue="">
            <option value="">Select host</option>
            {hostOptions.map((host) => (
              <option key={host.id} value={host.id}>
                {host.hostname} ({resolvePreferredSSHHost(host)})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>SSH Host</label>
          <input
            type="text"
            value={connection.host}
            onChange={(e) => setConnection((prev) => ({ ...prev, host: e.target.value }))}
            placeholder="192.168.1.100"
            required
          />
        </div>
        <div className="field compact">
          <label>Port</label>
          <input
            type="number"
            value={connection.sshPort}
            onChange={(e) => setConnection((prev) => ({ ...prev, sshPort: e.target.value }))}
            min="1"
            max="65535"
            required
          />
        </div>
        <div className="field">
          <label>SSH User</label>
          <input
            type="text"
            value={connection.sshUser}
            onChange={(e) => setConnection((prev) => ({ ...prev, sshUser: e.target.value }))}
            placeholder="zabbixadmin"
            required
          />
        </div>
        <div className="field">
          <label>SSH Password (optional)</label>
          <input
            type="password"
            value={connection.sshPassword}
            onChange={(e) => setConnection((prev) => ({ ...prev, sshPassword: e.target.value }))}
            placeholder="Leave blank if host accepts login without password"
          />
        </div>
        <button type="submit" className="connect-btn" disabled={loadingList}>
          {loadingList ? 'Connecting...' : 'Connect'}
        </button>
      </form>

      <section className="upload-panel">
        <div className="upload-panel-header">
          <h2>Bulk Upload</h2>
          <p>Send selected local files or folders to multiple servers at one common target path.</p>
        </div>

        <div className="upload-grid">
          <div className="field">
            <label>Common target path (under {DEFAULT_ROOT})</label>
            <input
              type="text"
              value={bulkUploadPath}
              onChange={(e) => setBulkUploadPath(normalizeUploadPath(e.target.value))}
              placeholder="Example: conf.d/custom"
            />
          </div>

          <div className="upload-hosts">
            <div className="upload-hosts-header">
              <label>Target hosts</label>
              <div className="upload-hosts-actions">
                <button type="button" onClick={selectAllUploadHosts}>Select all</button>
                <button type="button" onClick={clearUploadHosts}>Clear</button>
              </div>
            </div>

            <div className="upload-host-list">
              {hostOptions.map((host) => {
                const hostId = String(host.id ?? host.hostname);
                return (
                  <label key={hostId} className="upload-host-item">
                    <input
                      type="checkbox"
                      checked={selectedUploadHostIds.includes(hostId)}
                      onChange={() => toggleUploadHost(hostId)}
                    />
                    <span>{host.hostname} ({resolvePreferredSSHHost(host)})</span>
                  </label>
                );
              })}
            </div>
            <div className="upload-hint">
              If no hosts are selected, upload targets the SSH Host field above.
            </div>
          </div>

          <div className="upload-actions">
            <button
              type="button"
              className="upload-btn"
              onClick={() => fileUploadInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload size={14} />
              {uploading ? 'Uploading...' : 'Upload Files'}
            </button>
            <button
              type="button"
              className="upload-btn"
              onClick={() => folderUploadInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload size={14} />
              {uploading ? 'Uploading...' : 'Upload Folder'}
            </button>
          </div>
        </div>
      </section>

      <div className="workspace">
        <input
          ref={fileUploadInputRef}
          type="file"
          multiple
          onChange={onFileUploadChange}
          style={{ display: 'none' }}
        />
        <input
          ref={folderUploadInputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          onChange={onFolderUploadChange}
          style={{ display: 'none' }}
        />
        <div className="browser-pane">
          <div className="pane-toolbar">
            <div className="path-text">{DEFAULT_ROOT}{currentPath ? `/${currentPath}` : ''}</div>
            <div className="toolbar-actions">
              <button type="button" onClick={goUp} disabled={!connected || !currentPath}>Up</button>
              <button type="button" onClick={() => runList(currentPath)} disabled={!connected || loadingList}>
                <RefreshCw size={14} />
                Refresh
              </button>
              <button type="button" onClick={createFile} disabled={!connected}>
                <PlusCircle size={14} />
                New File
              </button>
              <button type="button" onClick={createDirectory} disabled={!connected}>
                <FolderPlus size={14} />
                New Folder
              </button>
            </div>
          </div>

          <div className="items-list">
            {!connected && <div className="empty">Connect to a host to browse files.</div>}
            {connected && items.length === 0 && <div className="empty">No files found.</div>}
            {items.map((item) => (
              <button
                type="button"
                key={item.relativePath}
                className={`item-row ${item.type === 'directory' ? 'dir' : 'file'} ${selectedFile === item.relativePath ? 'selected' : ''}`}
                onClick={() => (item.type === 'directory' ? openFolder(item) : openFile(item))}
              >
                <span className="item-name">
                  {item.type === 'directory' ? <Folder size={15} /> : <FileText size={15} />}
                  {item.name}
                </span>
                <span className="item-meta">{item.type === 'file' ? `${item.size} B` : 'Folder'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="editor-pane">
          <div className="pane-toolbar">
            <div className="path-text">{selectedFile ? `${DEFAULT_ROOT}/${selectedFile}` : 'No file selected'}</div>
            <button type="button" className="save-btn" onClick={saveFile} disabled={!selectedFile || !dirty || saving}>
              <Save size={14} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <textarea
            value={fileContent}
            onChange={(e) => {
              setFileContent(e.target.value);
              setDirty(true);
            }}
            placeholder="Open a file to view or edit content"
            disabled={!selectedFile}
          />
          <div className="editor-footer">
            <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            {selectedFile && (
              <span>
                size: {fileMeta.size || 0} bytes | mode: {fileMeta.mode || 'n/a'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemoteFilesPage;
