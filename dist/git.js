import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
const execFileAsync = promisify(execFile);
export async function getGitBranch(cwd) {
    if (!cwd)
        return null;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
export async function getGitStatus(cwd) {
    if (!cwd)
        return null;
    try {
        // Get branch name
        const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
        const branch = branchOut.trim();
        if (!branch)
            return null;
        // Check for dirty state and count uncommitted files
        let isDirty = false;
        let uncommittedCount = 0;
        let singleFileName;
        try {
            const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 1000, encoding: 'utf8' });
            const lines = statusOut.trim().split('\n').filter(Boolean);
            uncommittedCount = lines.length;
            isDirty = uncommittedCount > 0;
            // When only 1 file uncommitted, extract the filename
            if (uncommittedCount === 1 && lines[0]) {
                singleFileName = lines[0].slice(3).trim(); // Remove status prefix (e.g., " M ", "?? ")
            }
        }
        catch {
            // Ignore errors, assume clean
        }
        // Check for upstream and get ahead/behind counts
        let ahead = 0;
        let behind = 0;
        let hasUpstream = false;
        try {
            const { stdout: upstreamOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd, timeout: 1000, encoding: 'utf8' });
            hasUpstream = upstreamOut.trim().length > 0;
            if (hasUpstream) {
                const { stdout: revOut } = await execFileAsync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
                const parts = revOut.trim().split(/\s+/);
                if (parts.length === 2) {
                    behind = parseInt(parts[0], 10) || 0;
                    ahead = parseInt(parts[1], 10) || 0;
                }
            }
        }
        catch {
            // No upstream or error
            hasUpstream = false;
        }
        // Get last fetch time
        let lastFetchAgo;
        try {
            const gitDir = await findGitDir(cwd);
            if (gitDir) {
                const fetchHeadPath = path.join(gitDir, 'FETCH_HEAD');
                if (fs.existsSync(fetchHeadPath)) {
                    const stats = fs.statSync(fetchHeadPath);
                    const fetchTime = stats.mtimeMs;
                    const now = Date.now();
                    const diffMs = now - fetchTime;
                    const diffSecs = Math.floor(diffMs / 1000);
                    if (diffSecs < 60) {
                        lastFetchAgo = '<1m ago';
                    }
                    else if (diffSecs < 3600) {
                        lastFetchAgo = `${Math.floor(diffSecs / 60)}m ago`;
                    }
                    else if (diffSecs < 86400) {
                        lastFetchAgo = `${Math.floor(diffSecs / 3600)}h ago`;
                    }
                    else {
                        lastFetchAgo = `${Math.floor(diffSecs / 86400)}d ago`;
                    }
                }
            }
        }
        catch {
            // Ignore fetch time errors
        }
        return { branch, isDirty, ahead, behind, uncommittedCount, singleFileName, hasUpstream, lastFetchAgo };
    }
    catch {
        return null;
    }
}
async function findGitDir(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd, timeout: 1000, encoding: 'utf8' });
        const gitDir = stdout.trim();
        if (path.isAbsolute(gitDir)) {
            return gitDir;
        }
        return path.join(cwd, gitDir);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=git.js.map