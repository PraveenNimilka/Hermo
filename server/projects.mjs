import {z} from 'zod';
import {id} from './store.mjs';

export function installProjects(app,{store,fail}){
  const {db,audit}=store,defaultId='project_personal';
  db.exec('BEGIN IMMEDIATE');try{
    db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_projects(connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,project_id TEXT NOT NULL REFERENCES projects(id));`);
    db.prepare('INSERT OR IGNORE INTO projects VALUES (?,?,?)').run(defaultId,'Personal workspace',new Date().toISOString());
    db.prepare('INSERT OR IGNORE INTO connection_projects SELECT id,? FROM connections').run(defaultId);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const read=pid=>{const row=db.prepare('SELECT * FROM projects WHERE id=?').get(pid??defaultId);if(!row)fail('NOT_FOUND','Project not found.',404);return row;};
  const parse=(schema,body)=>{const result=schema.safeParse(body);if(!result.success)fail('INVALID_REQUEST','Check the project name and confirmation.');return result.data;};
  const name=z.string().trim().min(1).max(80);
  const ensure=()=>db.prepare('INSERT OR IGNORE INTO connection_projects SELECT id,? FROM connections').run(defaultId);
  const list=()=>{ensure();return db.prepare('SELECT p.*,count(cp.connection_id) connection_count,(SELECT count(*) FROM workflows w JOIN connection_projects scope ON scope.connection_id=w.connection_id WHERE scope.project_id=p.id) workflow_count FROM projects p LEFT JOIN connection_projects cp ON cp.project_id=p.id GROUP BY p.id ORDER BY p.created_at,p.id').all();};
  app.get('/studio/projects',async()=>({projects:list(),default_project_id:defaultId}));
  app.post('/studio/projects',async req=>{const body=parse(z.object({name}).strict(),req.body);if(db.prepare('SELECT count(*) n FROM projects').get().n>=20)fail('PROJECT_LIMIT','This workspace supports up to 20 local projects.',409);const pid=id('project');db.prepare('INSERT INTO projects VALUES (?,?,?)').run(pid,body.name,new Date().toISOString());audit('project.created',pid);return {project:read(pid)};});
  app.post('/studio/projects/:pid/rename',async req=>{const p=read(req.params.pid),body=parse(z.object({name}).strict(),req.body);db.prepare('UPDATE projects SET name=? WHERE id=?').run(body.name,p.id);audit('project.renamed',p.id);return {project:read(p.id)};});
  app.post('/studio/projects/:pid/remove',async req=>{const p=read(req.params.pid),body=parse(z.object({confirmation:z.string().max(220)}).strict(),req.body);ensure();if(body.confirmation!==`Delete "${p.name}"`)fail('CONFIRMATION_MISMATCH','Type the exact project deletion confirmation.');if(p.id===defaultId)fail('DEFAULT_PROJECT','The default project is retained for compatibility.',409);if(db.prepare('SELECT 1 FROM connection_projects WHERE project_id=?').get(p.id))fail('PROJECT_NOT_EMPTY','Move or delete this project’s connections before deleting the project.',409);db.prepare('DELETE FROM projects WHERE id=?').run(p.id);audit('project.removed',p.id);return {ok:true};});
  app.post('/studio/connections/:cid/project',async req=>{const body=parse(z.object({project_id:z.string().max(100)}).strict(),req.body),p=read(body.project_id);if(!db.prepare('SELECT 1 FROM connections WHERE id=?').get(req.params.cid))fail('NOT_FOUND','Connection not found.',404);if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workflow_execution_targets'").get()){const bindings=db.prepare('SELECT w.connection_id source,t.connection_id target FROM workflow_execution_targets t JOIN workflows w ON w.id=t.workflow_id WHERE w.connection_id=? OR t.connection_id=?').all(req.params.cid,req.params.cid);if(bindings.some(binding=>projectId(binding.source===req.params.cid?binding.target:binding.source)!==p.id))fail('EXECUTION_TARGET_BOUND','This connection and its workflow execution targets must stay in the same project. Remove the dependent workflows before moving it.',409);}assign(req.params.cid,p.id);audit('connection.project_changed',req.params.cid);return {ok:true,project_id:p.id};});
  function assign(cid,pid=defaultId){read(pid);db.prepare('INSERT INTO connection_projects VALUES (?,?) ON CONFLICT(connection_id) DO UPDATE SET project_id=excluded.project_id').run(cid,pid);}
  const projectId=cid=>{ensure();return db.prepare('SELECT project_id FROM connection_projects WHERE connection_id=?').get(cid)?.project_id??defaultId;};
  function scope(pid){ensure();const selected=read(pid);return {project:selected,connections:db.prepare('SELECT c.* FROM connections c JOIN connection_projects p ON p.connection_id=c.id WHERE p.project_id=? ORDER BY c.created_at DESC').all(selected.id),workflows:db.prepare('SELECT w.* FROM workflows w JOIN connection_projects p ON p.connection_id=w.connection_id WHERE p.project_id=? ORDER BY w.created_at DESC').all(selected.id)};}
  return {defaultId,read,list,assign,projectId,scope};
}
