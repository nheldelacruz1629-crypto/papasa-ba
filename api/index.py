"""
PASADOBA? - Grade Tracker Backend
Database-backed storage
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import socket
import uuid

import database

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

database.init_db()

# ==========================================================
# OOP PILLARS IN THE BACKEND
# Encapsulation: classes below wrap raw-score calculations and grading logic.
# Abstraction: GradingStrategy defines a clear interface for grade formulas.
# Inheritance: BaseGradingStrategy extends the base GradingStrategy class.
# Polymorphism: the grade service calls compute_final on any strategy instance.
# ==========================================================

class AssessmentCalculator:
    """Encapsulates raw score computations used by multiple endpoints."""

    def compute_weighted_raw(self, assessments, weights):
        if not assessments or not weights:
            return self.compute_equal_raw(assessments)

        total_weight = sum(weights.get(name, 0) for name in assessments)
        if total_weight == 0:
            return self.compute_equal_raw(assessments)

        weighted_sum = 0
        for name, assessment in assessments.items():
            w = weights.get(name, 0)
            avg = self.compute_assessment_average(assessment)
            weighted_sum += avg * (w / 100)

        # normalize in case weights don't total 100
        return round((weighted_sum / total_weight) * 100, 2)

    def compute_equal_raw(self, assessments):
        """Equal distribution — all assessment types count equally"""
        if not assessments:
            return 0
        total = sum(self.compute_assessment_average(a) for a in assessments.values())
        return round(total / len(assessments), 2)

    def compute_assessment_average(self, assessment):
        items = assessment.get('Items')
        if items is None:
            items = assessment.get('items', [])
        if not items:
            return 0
        total = 0
        count = 0
        for item in items:
            if not isinstance(item, dict):
                continue
            if 'Percentage' in item:
                total += item['Percentage']
                count += 1
            elif 'percentage' in item:
                total += item['percentage']
                count += 1
        if count == 0:
            return 0
        return total / count


class GradingStrategy:
    """Abstract grading strategy for converting raw scores to final grades."""

    def compute_final(self, raw_score):
        raise NotImplementedError("GradingStrategy.compute_final must be implemented.")


# Contribution (Software Engr 3): formula-based grading strategies (Raw/Base).
class RawGradingStrategy(GradingStrategy):
    def compute_final(self, raw_score):
        return round(raw_score, 2)


class BaseGradingStrategy(GradingStrategy):
    def __init__(self, base_value):
        self.base_value = base_value

    def compute_final(self, raw_score):
        return round(self.base_value + (raw_score * ((100 - self.base_value) / 100)), 2)


class GradingStrategyFactory:
    def get(self, strategy, base_value=0):
        if str(strategy).lower().startswith('base') and base_value is not None:
            return BaseGradingStrategy(base_value)
        return RawGradingStrategy()


class SubjectGradeService:
    def __init__(self, calculator, strategy_factory):
        self.calculator = calculator
        self.strategy_factory = strategy_factory

    def calculate(self, subject):
        assessments = subject.get('Assessments')
        if assessments is None:
            assessments = subject.get('assessments', {})
        weights = subject.get('Weights')
        if weights is None:
            weights = subject.get('weights', {})
        strategy = subject.get('Strategy')
        if strategy is None:
            strategy = subject.get('strategy', 'raw')
        base_value = subject.get('base_value', 0)

        if strategy == 'equal' or not weights:
            raw = self.calculator.compute_equal_raw(assessments)
        else:
            raw = self.calculator.compute_weighted_raw(assessments, weights)

        grading_strategy = self.strategy_factory.get(strategy, base_value)
        return grading_strategy.compute_final(raw)


_assessment_calculator = AssessmentCalculator()
_strategy_factory = GradingStrategyFactory()
_grade_service = SubjectGradeService(_assessment_calculator, _strategy_factory)

# ==========================================================
# PUP EQUIVALENT
# ==========================================================

def get_pup_equivalent(grade):
    if grade >= 96.5: return 1.00
    elif grade >= 93.5: return 1.25
    elif grade >= 90.5: return 1.50
    elif grade >= 87.5: return 1.75
    elif grade >= 84.5: return 2.00
    elif grade >= 81.5: return 2.25
    elif grade >= 78.5: return 2.50
    elif grade >= 75.5: return 2.75
    elif grade >= 74.5: return 3.00
    else: return 5.00

def get_status_message(grade):
    if grade >= 96.5: return "Excellent! Keep it up!"
    elif grade >= 74.5: return "Passed! Good job!"
    else: return "Failed - Seek help"

# ==========================================================
# STEP 1 — Compute weighted average across all assessments
# Uses the weights the user assigned to each assessment type
# ==========================================================

def compute_weighted_raw(assessments, weights):
    """
    Computes the weighted average of all assessments.
    weights = { "Quiz": 20, "Exam": 40, "Project": 40 }
    Returns a value from 0-100.
    """
    return _assessment_calculator.compute_weighted_raw(assessments, weights)

def compute_equal_raw(assessments):
    """Equal distribution — all assessment types count equally"""
    return _assessment_calculator.compute_equal_raw(assessments)

def compute_assessment_average(assessment):
    return _assessment_calculator.compute_assessment_average(assessment)

# ==========================================================
# STEP 2 — Apply grading strategy to the weighted raw score
# This converts the raw % into the final grade
# ==========================================================

def apply_grading_strategy(raw_score, strategy, base_value=0):
    """
    raw_score  = weighted average percentage (0-100)
    strategy   = 'raw', 'equal', 'base'
    base_value = e.g. 50 for Base 50, 30 for Base 30, 70 for Base 70

    Formulas:
    - Raw / Base 0:  final = raw_score
    - Base 50:       final = 50 + (raw_score * 0.50)
    - Base 30:       final = 30 + (raw_score * 0.70)
    - Base N:        final = N  + (raw_score * ((100 - N) / 100))
    - Equal:         handled before this step, raw_score passed as-is
    """
    grading_strategy = _strategy_factory.get(strategy, base_value)
    return grading_strategy.compute_final(raw_score)

def calculate_subject_grade(subject):
    return _grade_service.calculate(subject)

# ==========================================================
# WEIGHT VALIDATION
# ==========================================================

def validate_weights(weights, assessment_names):
    if not weights or not assessment_names:
        return True, None

    for name in assessment_names:
        value = weights.get(name, 0)

        # Check if number
        if not isinstance(value, (int, float)):
            return False, f'Weight for "{name}" must be a number.'

        # Check negative values
        if value < 0:
            return False, f'Weight for "{name}" cannot be negative.'

        # Check greater than 100
        if value > 100:
            return False, f'Weight for "{name}" cannot exceed 100%.'

    total = sum(weights.get(n, 0) for n in assessment_names)

    if abs(total - 100) > 0.01:
        diff = round(abs(100 - total), 2)
        direction = "Add" if total < 100 else "Remove"
        return False, (
            f"Weights total {round(total,2)}%. "
            f"{direction} {diff}% to reach 100%."
        )

    return True, None

# ==========================================================
# API ENDPOINTS
# ==========================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'PASADOBA? Backend is running!'})

# ==========================================================
# UI STORAGE ENDPOINTS (Frontend Model)
# ==========================================================

@app.route('/api/ui/subjects', methods=['GET'])
def ui_get_subjects():
    return jsonify({'subjects': database.list_ui_subjects()})

@app.route('/api/ui/subjects', methods=['POST'])
def ui_create_subject():
    data = request.json or {}
    subject = data.get('subject') or data
    name = (subject.get('name') or "").strip()
    if not name:
        return jsonify({'success': False, 'error': 'Name required'}), 400

    sid = subject.get('id') or str(uuid.uuid4())[:8]
    if database.ui_subject_exists(sid):
        return jsonify({'success': False, 'error': 'Subject ID already exists'}), 400

    subject['id'] = sid
    database.create_ui_subject(sid, subject)
    return jsonify({'success': True, 'subject': subject})

@app.route('/api/ui/subjects/<sid>', methods=['PUT'])
def ui_update_subject(sid):
    if not database.ui_subject_exists(sid):
        return jsonify({'success': False, 'error': 'Subject not found'}), 404
    data = request.json or {}
    subject = data.get('subject') or data
    subject['id'] = sid
    database.update_ui_subject(sid, subject)
    return jsonify({'success': True, 'subject': subject})

@app.route('/api/ui/subjects/<sid>', methods=['DELETE'])
def ui_delete_subject(sid):
    if not database.ui_subject_exists(sid):
        return jsonify({'error': 'Subject not found'}), 404
    database.delete_ui_subject(sid)
    return jsonify({'success': True, 'message': 'Subject deleted'})

@app.route('/api/network-info', methods=['GET'])
def network_info():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        local_ip = "127.0.0.1"
    return jsonify({'local_ip': local_ip, 'share_url': f'http://{local_ip}:8000'})

# Contribution (Software Engr 1): subject "folders" CRUD/organization endpoints.
@app.route('/api/subjects', methods=['GET'])
def get_subjects():
    result = []
    for subject in database.list_subjects():
        grade = calculate_subject_grade(subject)
        subject['current_grade'] = grade
        result.append({
            'id': subject['id'],
            'name': subject['name'],
            'current_grade': grade,
            'pup_equivalent': get_pup_equivalent(grade),
            'target_grade': subject.get('target_grade'),
            'strategy': subject.get('strategy', 'raw'),
            'base_value': subject.get('base_value', 0)
        })
    return jsonify({'subjects': result})

@app.route('/api/subjects', methods=['POST'])
def create_subject():
    data = request.json or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'Name required'}), 400
    if database.subject_name_exists(name):
        return jsonify({'success': False, 'error': 'Subject already exists'}), 400
    sid = database.create_subject(
        name=name,
        strategy=data.get('strategy', 'raw'),
        base_value=data.get('base_value', 0),
        target_grade=data.get('target_grade')
    )
    return jsonify({'success': True, 'message': f'Subject "{name}" created', 'subject_id': sid})

@app.route('/api/subjects/<sid>', methods=['GET'])
def get_subject(sid):
    subject = database.get_subject(sid)
    if not subject:
        return jsonify({'error': 'Subject not found'}), 404
    grade = calculate_subject_grade(subject)
    subject['current_grade'] = grade
    return jsonify({
        'id': sid,
        'name': subject['name'],
        'current_grade': grade,
        'pup_equivalent': get_pup_equivalent(grade),
        'status_message': get_status_message(grade),
        'target_grade': subject.get('target_grade'),
        'strategy': subject.get('strategy', 'raw'),
        'base_value': subject.get('base_value', 0),
        'weights': subject.get('weights', {}),
        'assessments': subject.get('assessments', {})
    })

@app.route('/api/subjects/<sid>', methods=['PUT'])
def update_subject(sid):
    if not database.subject_exists(sid):
        return jsonify({'success': False, 'error': 'Subject not found'}), 404
    data = request.json or {}
    database.update_subject(sid, data)
    return jsonify({'success': True, 'message': 'Subject updated'})

@app.route('/api/subjects/<sid>', methods=['DELETE'])
def delete_subject(sid):
    subject = database.get_subject(sid)
    if not subject:
        return jsonify({'error': 'Subject not found'}), 404
    database.delete_subject(sid)
    return jsonify({'success': True, 'message': f'Deleted "{subject["name"]}"'})

@app.route('/api/subjects/<sid>/assessments', methods=['POST'])
def add_assessment(sid):
    if not database.subject_exists(sid):
        return jsonify({'error': 'Subject not found'}), 404
    data = request.json or {}
    name = data.get('assessment_type', '').strip()
    weight = data.get('weight')
    if not name:
        return jsonify({'success': False, 'error': 'Assessment name required'}), 400
    if database.assessment_exists(sid, name):
        return jsonify({'success': False, 'error': 'Assessment type already exists'}), 400
    database.add_assessment(sid, name, weight)
    return jsonify({'success': True, 'message': f'Added "{name}"'})

@app.route('/api/subjects/<sid>/assessments/<aname>', methods=['DELETE'])
def delete_assessment(sid, aname):
    if not database.subject_exists(sid):
        return jsonify({'error': 'Subject not found'}), 404
    if not database.assessment_exists(sid, aname):
        return jsonify({'error': 'Assessment not found'}), 404
    database.delete_assessment(sid, aname)
    return jsonify({'success': True, 'message': f'Deleted "{aname}"'})

@app.route('/api/subjects/<sid>/weights', methods=['PUT'])
def set_weights(sid):
    if not database.subject_exists(sid):
        return jsonify({'success': False, 'error': 'Subject not found'}), 404
    data = request.json or {}
    new_weights = data.get('weights', {})
    assessment_names = database.get_assessment_names(sid)
    is_valid, error = validate_weights(new_weights, assessment_names)
    if not is_valid:
        return jsonify({'success': False, 'error': error}), 400
    database.set_weights(sid, new_weights)
    subject = database.get_subject(sid)
    grade = calculate_subject_grade(subject)
    return jsonify({'success': True, 'message': 'Weights saved!', 'new_grade': grade})

# Contribution (Software Engr 2): raw score entry + validation logic.
@app.route('/api/subjects/<sid>/scores', methods=['POST'])
def add_score(sid):
    if not database.subject_exists(sid):
        return jsonify({'error': 'Subject not found'}), 404
    data = request.json or {}
    aname = data.get('assessment_type')
    item_name = data.get('name')
    score = data.get('score')
    max_score = data.get('max_score')

    if score is None or max_score is None:
        return jsonify({
            'success': False,
            'error': 'Score and Max Score is required'
        }), 400
    if score < 0:
        return jsonify({
            'success': False,
            'error': 'Score cannot be Negative'
        }), 400
    if max_score <= 0:
        return jsonify({
            'success': False,
            'error': 'Max Score must be Greater than zero'
        }), 400
    if score > max_score:
        return jsonify({
            'success': False,
            'error': 'Score cannot be exceed Max Score'
        }), 400
    
    if not database.assessment_exists(sid, aname):
        return jsonify({'success': False, 'error': 'Assessment type not found'}), 400
    percentage = round((score / max_score) * 100, 2) if max_score > 0 else 0
    score_id = str(uuid.uuid4())[:8]
    database.add_score(
        subject_id=sid,
        assessment_name=aname,
        score_id=score_id,
        item_name=item_name,
        score=score,
        max_score=max_score,
        percentage=percentage
    )
    grade = calculate_subject_grade(database.get_subject(sid))
    return jsonify({
        'success': True, 'message': f'Added "{item_name}"',
        'score_id': score_id, 'new_grade': grade,
        'pup_equivalent': get_pup_equivalent(grade)
    })

@app.route('/api/subjects/<sid>/scores/<score_id>', methods=['DELETE'])
def delete_score(sid, score_id):
    if not database.subject_exists(sid):
        return jsonify({'error': 'Subject not found'}), 404
    if not database.delete_score(sid, score_id):
        return jsonify({'error': 'Score not found'}), 404
    grade = calculate_subject_grade(database.get_subject(sid))
    return jsonify({'success': True, 'message': 'Score deleted', 'new_grade': grade})

@app.route('/api/overall', methods=['GET'])
def get_overall():
    subjects = []
    for subject in database.list_subjects():
        grade = calculate_subject_grade(subject)
        subject['current_grade'] = grade
        subjects.append({'id': subject['id'], 'name': subject['name'],
                         'current_grade': grade, 'pup_equivalent': get_pup_equivalent(grade)})
    if not subjects:
        return jsonify({'overall_gpa': 0, 'pup_equivalent': 5.00,
                        'best_subject': ['None', 0], 'worst_subject': ['None', 0],
                        'total_subjects': 0, 'subjects': []})
    avg = round(sum(s['current_grade'] for s in subjects) / len(subjects), 2)
    best = max(subjects, key=lambda x: x['current_grade'])
    worst = min(subjects, key=lambda x: x['current_grade'])
    return jsonify({'overall_gpa': avg, 'pup_equivalent': get_pup_equivalent(avg),
                    'best_subject': [best['name'], best['current_grade']],
                    'worst_subject': [worst['name'], worst['current_grade']],
                    'total_subjects': len(subjects), 'subjects': subjects})

def main():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        local_ip = "127.0.0.1"
    print("=" * 60)
    print("   P A S A D O B A ?  - Grade Tracker")
    print("=" * 60)
    print(f"  Local:  http://localhost:5000")
    print(f"  Share:  http://{local_ip}:8000")
    print(f"  Press CTRL+C to stop")
    print("=" * 60)
    app.run(host='0.0.0.0', debug=True, port=5000)

if __name__ == '__main__':
    main()
