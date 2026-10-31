import {env} from 'cloudflare:workers';
import {handleWorkspaceRequest} from '../../../lib/workspace-api.mjs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>handleWorkspaceRequest(request,env.DB,env.BUCKET);
export const PUT=(request:Request)=>handleWorkspaceRequest(request,env.DB,env.BUCKET);
