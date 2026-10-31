import {env} from 'cloudflare:workers';
import {handleWorkspaceRequest} from '../../../../lib/workspace-api.mjs';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>handleWorkspaceRequest(request,env.DB,env.BUCKET);
