import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Folder, FileText, RefreshCw, Save, PlusCircle } from 'lucide-react';
import {
  listRemoteFiles,
  readRemoteFile,
  writeRemoteFile,
  createRemoteFile
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
  const [fileMeta, setFileMeta] = useState({ mtime: null, size: 0, mode: '' });

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

      <div className="workspace">
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
