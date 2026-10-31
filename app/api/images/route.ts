import {env} from 'cloudflare:workers';
import {handleImageRequest} from '../../../lib/images-api.mjs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>handleImageRequest(request,env.BUCKET);
export const POST=(request:Request)=>handleImageRequest(request,env.BUCKET);
