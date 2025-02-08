import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { URI } from '../../../../../../../base/common/uri.js';
import { useAccessor } from './services.js';
import { useFloating, autoUpdate, offset, flip, shift } from '@floating-ui/react';
import { basename, dirname } from '../../../../../../../base/common/resources.js';
import { StagingSelectionItem } from '../../../chatThreadService.js';
import { EditorsOrder } from '../../../../../../../workbench/common/editor.js';

interface FileWithMetadata {
    uri: URI;
    isOpen: boolean;
}

interface FilePickerMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (selection: StagingSelectionItem) => void;
    anchorEl: HTMLElement | null;
    searchText: string;
}

export const FilePickerMenu: React.FC<FilePickerMenuProps> = ({
    isOpen,
    onClose,
    onSelect,
    anchorEl,
    searchText
}) => {
    const accessor = useAccessor();
    const [files, setFiles] = useState<FileWithMetadata[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const { refs, floatingStyles } = useFloating({
        placement: 'top-start',
        middleware: [
            offset(5),
            flip({
                fallbackPlacements: ['bottom-start'],
                padding: 5
            }),
            shift({
                padding: 5
            })
        ],
        whileElementsMounted: autoUpdate,
        elements: {
            reference: anchorEl
        }
    });

    // Get all workspace files
    useEffect(() => {
        let mounted = true;

        const fetchFiles = async () => {
            if (!isOpen) return;
            if (!mounted) return;

            setIsLoading(true);
            try {
                const workspaceService = accessor.get('IWorkspaceContextService');
                const editorService = accessor.get('IEditorService');
                const fileService = accessor.get('IFileService');

                // Get open editors first
                const openEditors = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)
                    .map(editor => editor.editor.resource)
                    .filter((uri): uri is URI => uri !== undefined)
                    .map(uri => ({ uri, isOpen: true }));

                if (!mounted) return;

                // Get files from workspace folders
                const folders = workspaceService.getWorkspace().folders;
                const workspaceFiles: FileWithMetadata[] = [];

                for (const folder of folders) {
                    if (!mounted) return;
                    try {
                        const files = await fileService.resolve(folder.uri, { resolveMetadata: true });
                        if (files.children) {
                            const folderFiles = files.children
                                .filter(file => !file.isDirectory)
                                .map(file => ({
                                    uri: file.resource,
                                    isOpen: false
                                }));
                            workspaceFiles.push(...folderFiles);
                        }
                    } catch (error) {
                        console.error('Error getting folder files:', error);
                    }
                }

                if (!mounted) return;

                // Filter out duplicates and limit to reasonable number
                const allFiles = [
                    ...openEditors,
                    ...workspaceFiles.filter(wf =>
                        !openEditors.some(oe => oe.uri.toString() === wf.uri.toString())
                    )
                ].slice(0, 100);

                setFiles(allFiles);
            } catch (error) {
                console.error('Error getting files:', error);
                if (mounted) {
                    setFiles([]);
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchFiles();

        return () => {
            mounted = false;
        };
    }, [isOpen]); // Only re-run when isOpen changes

    // Reset selected index when files or search text changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [files, searchText]);

    // Helper function for fuzzy search
    const fuzzyMatch = (str: string, term: string): boolean => {
        let strIndex = 0;
        let termIndex = 0;
        str = str.toLowerCase();
        term = term.toLowerCase();

        while (strIndex < str.length && termIndex < term.length) {
            if (str[strIndex] === term[termIndex]) {
                termIndex++;
            }
            strIndex++;
        }

        return termIndex === term.length;
    };

    // Filter files based on search text
    const filteredFiles = useMemo(() => {
        if (!searchText) return files;

        // Split search text into terms
        const terms = searchText.trim().split(/\s+/);

        return files.filter(({ uri }) => {
            const fileName = basename(uri).toLowerCase();
            const filePath = uri.path.toLowerCase();

            // All terms must match either filename or path
            return terms.every(term => {
                // Try exact match first
                if (fileName.includes(term.toLowerCase()) || filePath.includes(term.toLowerCase())) {
                    return true;
                }
                // Try fuzzy match if exact match fails
                return fuzzyMatch(fileName, term) || fuzzyMatch(filePath, term);
            });
        });
    }, [files, searchText]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(i => Math.min(i + 1, filteredFiles.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(i => Math.max(i - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredFiles[selectedIndex]) {
                    const selection: StagingSelectionItem = {
                        type: 'File',
                        fileURI: filteredFiles[selectedIndex].uri,
                        selectionStr: null,
                        range: null
                    };
                    onSelect(selection);
                    onClose();
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [isOpen, filteredFiles, selectedIndex, onSelect, onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    if (!isOpen) return null;

    const getDisplayPath = (uri: URI) => {
        const path = dirname(uri).path;
        const segments = path.split('/');
        // Show last 2 segments of the path
        return segments.slice(-2).join('/');
    };

    const FileReference = ({ fileName }: { fileName: string }) => {
        return (
            <span className="inline-flex items-center bg-void-bg-2 rounded px-1.5 py-0.5 text-void-fg-1 text-sm">
                <span className="text-void-fg-3">@</span>
                <span className="ml-1">{fileName}</span>
            </span>
        );
    };

    return (
        <div
            ref={refs.setFloating}
            style={{
                ...floatingStyles,
                zIndex: 9999,
                position: 'fixed'
            }}
            className="bg-void-bg-1 border border-void-border-1 rounded-md shadow-lg overflow-hidden min-w-[300px]"
        >
            <div className="max-h-[300px] overflow-y-auto">
                {isLoading ? (
                    <div className="p-2 text-void-fg-3">Loading files...</div>
                ) : filteredFiles.length === 0 ? (
                    <div className="p-2 text-void-fg-3">No files found</div>
                ) : (
                    <>
                        {/* Open files section */}
                        {filteredFiles.some(f => f.isOpen) && (
                            <div className="border-b border-void-border-2">
                                <div className="px-2 py-1 text-xs text-void-fg-3 bg-void-bg-2">Open Files</div>
                                {filteredFiles.filter(f => f.isOpen).map((file, index) => (
                                    <div
                                        key={file.uri.toString()}
                                        className={`
                                            p-2 cursor-pointer flex justify-between items-center
                                            ${index === selectedIndex ? 'bg-void-bg-3' : 'hover:bg-void-bg-2'}
                                        `}
                                        onClick={() => {
                                            const selection: StagingSelectionItem = {
                                                type: 'File',
                                                fileURI: file.uri,
                                                selectionStr: null,
                                                range: null
                                            };
                                            onSelect(selection);
                                            onClose();
                                        }}
                                    >
                                        <span className="font-medium truncate flex-shrink-0 mr-2">
                                            {basename(file.uri)}
                                        </span>
                                        <span className="text-void-fg-3 text-xs truncate text-right">
                                            {getDisplayPath(file.uri)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Workspace files section */}
                        {filteredFiles.some(f => !f.isOpen) && (
                            <div>
                                <div className="px-2 py-1 text-xs text-void-fg-3 bg-void-bg-2">Workspace Files</div>
                                {filteredFiles.filter(f => !f.isOpen).map((file, index) => (
                                    <div
                                        key={file.uri.toString()}
                                        className={`
                                            p-2 cursor-pointer flex justify-between items-center
                                            ${index + filteredFiles.filter(f => f.isOpen).length === selectedIndex ? 'bg-void-bg-3' : 'hover:bg-void-bg-2'}
                                        `}
                                        onClick={() => {
                                            const selection: StagingSelectionItem = {
                                                type: 'File',
                                                fileURI: file.uri,
                                                selectionStr: null,
                                                range: null
                                            };
                                            onSelect(selection);
                                            onClose();
                                        }}
                                    >
                                        <span className="font-medium truncate flex-shrink-0 mr-2">
                                            {basename(file.uri)}
                                        </span>
                                        <span className="text-void-fg-3 text-xs truncate text-right">
                                            {getDisplayPath(file.uri)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
