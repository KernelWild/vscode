/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { toSlashes } from 'vs/base/common/extpath';
import * as json from 'vs/base/common/json';
import * as jsonEdit from 'vs/base/common/jsonEdit';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { Schemas } from 'vs/base/common/network';
import { isAbsolute } from 'vs/base/common/path';
import { isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { IExtUri, isEqualAuthority } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { IBaseWorkspace, IRawFileWorkspaceFolder, IRawUriWorkspaceFolder, IWorkspaceIdentifier, WorkspaceFolder } from 'vs/platform/workspace/common/workspace';

export const IWorkspacesService = createDecorator<IWorkspacesService>('workspacesService');

export interface IWorkspacesService {

	readonly _serviceBrand: undefined;

	// Workspaces Management
	enterWorkspace(path: URI): Promise<IEnterWorkspaceResult | undefined>;
	createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier>;
	deleteUntitledWorkspace(workspace: IWorkspaceIdentifier): Promise<void>;
	getWorkspaceIdentifier(workspacePath: URI): Promise<IWorkspaceIdentifier>;

	// Workspaces History
	readonly onDidChangeRecentlyOpened: Event<void>;
	addRecentlyOpened(recents: IRecent[]): Promise<void>;
	removeRecentlyOpened(workspaces: URI[]): Promise<void>;
	clearRecentlyOpened(): Promise<void>;
	getRecentlyOpened(): Promise<IRecentlyOpened>;

	// Dirty Workspaces
	getDirtyWorkspaces(): Promise<Array<IWorkspaceBackupInfo | IFolderBackupInfo>>;
}

//#region Workspaces Recently Opened

export interface IRecentlyOpened {
	workspaces: Array<IRecentWorkspace | IRecentFolder>;
	files: IRecentFile[];
}

export type IRecent = IRecentWorkspace | IRecentFolder | IRecentFile;

export interface IRecentWorkspace {
	workspace: IWorkspaceIdentifier;
	label?: string;
	remoteAuthority?: string;
}

export interface IRecentFolder {
	folderUri: URI;
	label?: string;
	remoteAuthority?: string;
}

export interface IRecentFile {
	fileUri: URI;
	label?: string;
	remoteAuthority?: string;
}

export function isRecentWorkspace(curr: IRecent): curr is IRecentWorkspace {
	return curr.hasOwnProperty('workspace');
}

export function isRecentFolder(curr: IRecent): curr is IRecentFolder {
	return curr.hasOwnProperty('folderUri');
}

export function isRecentFile(curr: IRecent): curr is IRecentFile {
	return curr.hasOwnProperty('fileUri');
}

//#endregion

//#region Backups

export interface IWorkspaceBackupInfo {
	workspace: IWorkspaceIdentifier;
	remoteAuthority?: string;
}

export interface IFolderBackupInfo {
	folderUri: URI;
	remoteAuthority?: string;
}

export function isFolderBackupInfo(curr: IWorkspaceBackupInfo | IFolderBackupInfo): curr is IFolderBackupInfo {
	return curr && curr.hasOwnProperty('folderUri');
}

export function isWorkspaceBackupInfo(curr: IWorkspaceBackupInfo | IFolderBackupInfo): curr is IWorkspaceBackupInfo {
	return curr && curr.hasOwnProperty('workspace');
}

//#endregion

//#region Workspace File Utilities

export function isStoredWorkspaceFolder(obj: unknown): obj is IStoredWorkspaceFolder {
	return isRawFileWorkspaceFolder(obj) || isRawUriWorkspaceFolder(obj);
}

export function isRawFileWorkspaceFolder(obj: unknown): obj is IRawFileWorkspaceFolder {
	const candidate = obj as IRawFileWorkspaceFolder | undefined;

	return typeof candidate?.path === 'string' && (!candidate.name || typeof candidate.name === 'string');
}

export function isRawUriWorkspaceFolder(obj: unknown): obj is IRawUriWorkspaceFolder {
	const candidate = obj as IRawUriWorkspaceFolder | undefined;

	return typeof candidate?.uri === 'string' && (!candidate.name || typeof candidate.name === 'string');
}

export type IStoredWorkspaceFolder = IRawFileWorkspaceFolder | IRawUriWorkspaceFolder;

export interface IStoredWorkspace extends IBaseWorkspace {
	folders: IStoredWorkspaceFolder[];
}

export interface IWorkspaceFolderCreationData {
	uri: URI;
	name?: string;
}

export interface IUntitledWorkspaceInfo {
	workspace: IWorkspaceIdentifier;
	remoteAuthority?: string;
}

export interface IEnterWorkspaceResult {
	workspace: IWorkspaceIdentifier;
	backupPath?: string;
}

/**
 * Given a folder URI and the workspace config folder, computes the IStoredWorkspaceFolder using
* a relative or absolute path or a uri.
 * Undefined is returned if the folderURI and the targetConfigFolderURI don't have the same schema or authority
 *
 * @param folderURI a workspace folder
 * @param forceAbsolute if set, keep the path absolute
 * @param folderName a workspace name
 * @param targetConfigFolderURI the folder where the workspace is living in
 * @param useSlashForPath if set, use forward slashes for file paths on windows
 */
export function getStoredWorkspaceFolder(folderURI: URI, forceAbsolute: boolean, folderName: string | undefined, targetConfigFolderURI: URI, useSlashForPath = !isWindows, extUri: IExtUri): IStoredWorkspaceFolder {
	if (folderURI.scheme !== targetConfigFolderURI.scheme) {
		return { name: folderName, uri: folderURI.toString(true) };
	}

	let folderPath = !forceAbsolute ? extUri.relativePath(targetConfigFolderURI, folderURI) : undefined;
	if (folderPath !== undefined) {
		if (folderPath.length === 0) {
			folderPath = '.';
		} else if (isWindows && folderURI.scheme === Schemas.file && !useSlashForPath) {
			// Windows gets special treatment:
			// - use backslahes unless slash is used by other existing folders
			folderPath = folderPath.replace(/\//g, '\\');
		}
	} else {

		// use absolute path
		if (folderURI.scheme === Schemas.file) {
			folderPath = folderURI.fsPath;
			if (isWindows) {
				// Windows gets special treatment:
				// - normalize all paths to get nice casing of drive letters
				// - use backslahes unless slash is used by other existing folders
				folderPath = normalizeDriveLetter(folderPath);
				if (useSlashForPath) {
					folderPath = toSlashes(folderPath);
				}
			}
		} else {
			if (!extUri.isEqualAuthority(folderURI.authority, targetConfigFolderURI.authority)) {
				return { name: folderName, uri: folderURI.toString(true) };
			}
			folderPath = folderURI.path;
		}
	}

	return { name: folderName, path: folderPath };
}

export function toWorkspaceFolders(configuredFolders: IStoredWorkspaceFolder[], workspaceConfigFile: URI, extUri: IExtUri): WorkspaceFolder[] {
	let result: WorkspaceFolder[] = [];
	let seen: Set<string> = new Set();

	const relativeTo = extUri.dirname(workspaceConfigFile);
	for (let configuredFolder of configuredFolders) {
		let uri: URI | undefined = undefined;
		if (isRawFileWorkspaceFolder(configuredFolder)) {
			if (configuredFolder.path) {
				uri = extUri.resolvePath(relativeTo, configuredFolder.path);
			}
		} else if (isRawUriWorkspaceFolder(configuredFolder)) {
			try {
				uri = URI.parse(configuredFolder.uri);
				if (uri.path[0] !== '/') {
					uri = uri.with({ path: '/' + uri.path }); // this makes sure all workspace folder are absolute
				}
			} catch (e) {
				console.warn(e); // ignore
			}
		}

		if (uri) {

			// remove duplicates
			let comparisonKey = extUri.getComparisonKey(uri);
			if (!seen.has(comparisonKey)) {
				seen.add(comparisonKey);

				const name = configuredFolder.name || extUri.basenameOrAuthority(uri);
				result.push(new WorkspaceFolder({ uri, name, index: result.length }, configuredFolder));
			}
		}
	}

	return result;
}

/**
 * Rewrites the content of a workspace file to be saved at a new location.
 * Throws an exception if file is not a valid workspace file
 */
export function rewriteWorkspaceFileForNewLocation(rawWorkspaceContents: string, configPathURI: URI, isFromUntitledWorkspace: boolean, targetConfigPathURI: URI, extUri: IExtUri) {
	let storedWorkspace = doParseStoredWorkspace(configPathURI, rawWorkspaceContents);

	const sourceConfigFolder = extUri.dirname(configPathURI);
	const targetConfigFolder = extUri.dirname(targetConfigPathURI);

	const rewrittenFolders: IStoredWorkspaceFolder[] = [];
	const slashForPath = useSlashForPath(storedWorkspace.folders);

	for (const folder of storedWorkspace.folders) {
		const folderURI = isRawFileWorkspaceFolder(folder) ? extUri.resolvePath(sourceConfigFolder, folder.path) : URI.parse(folder.uri);
		let absolute;
		if (isFromUntitledWorkspace) {
			absolute = false; // if it was an untitled workspace, try to make paths relative
		} else {
			absolute = !isRawFileWorkspaceFolder(folder) || isAbsolute(folder.path); // for existing workspaces, preserve whether a path was absolute or relative
		}
		rewrittenFolders.push(getStoredWorkspaceFolder(folderURI, absolute, folder.name, targetConfigFolder, slashForPath, extUri));
	}

	// Preserve as much of the existing workspace as possible by using jsonEdit
	// and only changing the folders portion.
	const formattingOptions: FormattingOptions = { insertSpaces: false, tabSize: 4, eol: (isLinux || isMacintosh) ? '\n' : '\r\n' };
	const edits = jsonEdit.setProperty(rawWorkspaceContents, ['folders'], rewrittenFolders, formattingOptions);
	let newContent = jsonEdit.applyEdits(rawWorkspaceContents, edits);

	if (isEqualAuthority(storedWorkspace.remoteAuthority, getRemoteAuthority(targetConfigPathURI))) {
		// unsaved remote workspaces have the remoteAuthority set. Remove it when no longer nexessary.
		newContent = jsonEdit.applyEdits(newContent, jsonEdit.removeProperty(newContent, ['remoteAuthority'], formattingOptions));
	}

	return newContent;
}

function doParseStoredWorkspace(path: URI, contents: string): IStoredWorkspace {

	// Parse workspace file
	let storedWorkspace: IStoredWorkspace = json.parse(contents); // use fault tolerant parser

	// Filter out folders which do not have a path or uri set
	if (storedWorkspace && Array.isArray(storedWorkspace.folders)) {
		storedWorkspace.folders = storedWorkspace.folders.filter(folder => isStoredWorkspaceFolder(folder));
	} else {
		throw new Error(`${path} looks like an invalid workspace file.`);
	}

	return storedWorkspace;
}

export function useSlashForPath(storedFolders: IStoredWorkspaceFolder[]): boolean {
	if (isWindows) {
		return storedFolders.some(folder => isRawFileWorkspaceFolder(folder) && folder.path.indexOf('/') >= 0);
	}

	return true;
}

//#endregion

//#region Workspace Storage

interface ISerializedRecentWorkspace {
	workspace: {
		id: string;
		configPath: string;
	};
	label?: string;
	remoteAuthority?: string;
}

interface ISerializedRecentFolder {
	folderUri: string;
	label?: string;
	remoteAuthority?: string;
}

interface ISerializedRecentFile {
	fileUri: string;
	label?: string;
	remoteAuthority?: string;
}

interface ISerializedRecentlyOpenedLegacy {
	workspaces3: Array<{ id: string; configURIPath: string } | string>; // workspace or URI.toString() // added in 1.32
	workspaceLabels?: Array<string | null>; // added in 1.33
	files2: string[]; // files as URI.toString() // added in 1.32
	fileLabels?: Array<string | null>; // added in 1.33
}

interface ISerializedRecentlyOpened {
	entries: Array<ISerializedRecentWorkspace | ISerializedRecentFolder | ISerializedRecentFile>; // since 1.55
}

export type RecentlyOpenedStorageData = object;

function isSerializedRecentWorkspace(data: any): data is ISerializedRecentWorkspace {
	return data.workspace && typeof data.workspace === 'object' && typeof data.workspace.id === 'string' && typeof data.workspace.configPath === 'string';
}

function isSerializedRecentFolder(data: any): data is ISerializedRecentFolder {
	return typeof data.folderUri === 'string';
}

function isSerializedRecentFile(data: any): data is ISerializedRecentFile {
	return typeof data.fileUri === 'string';
}

export function restoreRecentlyOpened(data: RecentlyOpenedStorageData | undefined, logService: ILogService): IRecentlyOpened {
	const result: IRecentlyOpened = { workspaces: [], files: [] };
	if (data) {
		const restoreGracefully = function <T>(entries: T[], func: (entry: T, index: number) => void) {
			for (let i = 0; i < entries.length; i++) {
				try {
					func(entries[i], i);
				} catch (e) {
					logService.warn(`Error restoring recent entry ${JSON.stringify(entries[i])}: ${e.toString()}. Skip entry.`);
				}
			}
		};

		const storedRecents = data as ISerializedRecentlyOpened;
		if (Array.isArray(storedRecents.entries)) {
			restoreGracefully(storedRecents.entries, (entry) => {
				const label = entry.label;
				const remoteAuthority = entry.remoteAuthority;

				if (isSerializedRecentWorkspace(entry)) {
					result.workspaces.push({ label, remoteAuthority, workspace: { id: entry.workspace.id, configPath: URI.parse(entry.workspace.configPath) } });
				} else if (isSerializedRecentFolder(entry)) {
					result.workspaces.push({ label, remoteAuthority, folderUri: URI.parse(entry.folderUri) });
				} else if (isSerializedRecentFile(entry)) {
					result.files.push({ label, remoteAuthority, fileUri: URI.parse(entry.fileUri) });
				}
			});
		} else {
			const storedRecents2 = data as ISerializedRecentlyOpenedLegacy;
			if (Array.isArray(storedRecents2.workspaces3)) {
				restoreGracefully(storedRecents2.workspaces3, (workspace, i) => {
					const label: string | undefined = (Array.isArray(storedRecents2.workspaceLabels) && storedRecents2.workspaceLabels[i]) || undefined;
					if (typeof workspace === 'object' && typeof workspace.id === 'string' && typeof workspace.configURIPath === 'string') {
						result.workspaces.push({ label, workspace: { id: workspace.id, configPath: URI.parse(workspace.configURIPath) } });
					} else if (typeof workspace === 'string') {
						result.workspaces.push({ label, folderUri: URI.parse(workspace) });
					}
				});
			}
			if (Array.isArray(storedRecents2.files2)) {
				restoreGracefully(storedRecents2.files2, (file, i) => {
					const label: string | undefined = (Array.isArray(storedRecents2.fileLabels) && storedRecents2.fileLabels[i]) || undefined;
					if (typeof file === 'string') {
						result.files.push({ label, fileUri: URI.parse(file) });
					}
				});
			}
		}
	}

	return result;
}

export function toStoreData(recents: IRecentlyOpened): RecentlyOpenedStorageData {
	const serialized: ISerializedRecentlyOpened = { entries: [] };

	for (const recent of recents.workspaces) {
		if (isRecentFolder(recent)) {
			serialized.entries.push({ folderUri: recent.folderUri.toString(), label: recent.label, remoteAuthority: recent.remoteAuthority });
		} else {
			serialized.entries.push({ workspace: { id: recent.workspace.id, configPath: recent.workspace.configPath.toString() }, label: recent.label, remoteAuthority: recent.remoteAuthority });
		}
	}

	for (const recent of recents.files) {
		serialized.entries.push({ fileUri: recent.fileUri.toString(), label: recent.label, remoteAuthority: recent.remoteAuthority });
	}

	return serialized;
}

//#endregion
